import type { Prisma, Job, JobStatus } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 27 Section 4-7: a general-purpose, lease-based production job
 * queue. Distinct from Phase 26's `ScheduledJobRun` (a narrow idempotency
 * ledger scoped to the credit-grant job specifically) — this supports
 * arbitrary job types under one lifecycle:
 *
 *   PENDING  -> CLAIMED -> RUNNING -> SUCCEEDED
 *   RUNNING  -> RETRY_WAIT -> CLAIMED   (retry, exponential backoff)
 *   RUNNING  -> FAILED                  (terminal / dead-letter, maxAttempts exhausted)
 *
 * Crash recovery: a job whose lease (`leaseExpiresAt`) has passed while
 * still CLAIMED/RUNNING is treated as claimable again by ANY worker — the
 * worker that held the lease is presumed dead. No separate "reaper" process
 * is needed; the claim query itself folds expired-lease jobs back into the
 * claimable set.
 *
 * The concurrency guarantee (exactly one worker wins a contested claim) is
 * a real Postgres row-level guarantee: every claim is a conditional
 * `updateMany` keyed on the job's CURRENT status/lease state, and only the
 * update that observes the pre-claim state affects a row — concurrent
 * updates racing for the same row serialize at the database, and every
 * loser's WHERE clause simply matches zero rows once the winner commits.
 */

const DEFAULT_LEASE_MS = 30_000;

export interface EnqueueJobInput {
  jobKey: string;
  dedupeKey: string;
  payload?: Prisma.InputJsonValue;
  maxAttempts?: number;
  runAt?: Date;
}

/** Idempotent enqueue: at most one Job per (jobKey, dedupeKey) — a real Postgres unique constraint, not check-then-insert. */
export async function enqueueJob(input: EnqueueJobInput): Promise<{ job: Job; created: boolean }> {
  try {
    const job = await prisma.job.create({
      data: {
        jobKey: input.jobKey,
        dedupeKey: input.dedupeKey,
        payload: input.payload,
        maxAttempts: input.maxAttempts ?? 5,
        nextRunAt: input.runAt ?? new Date(),
      },
    });
    return { job, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.job.findUniqueOrThrow({ where: { jobKey_dedupeKey: { jobKey: input.jobKey, dedupeKey: input.dedupeKey } } });
    return { job: existing, created: false };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && 'code' in err && ((err as { code?: string }).code === 'P2002' || (err as { code?: string }).code === '23505');
}

function claimableWhere(now: Date): Prisma.JobWhereInput {
  return {
    OR: [
      { status: 'PENDING', nextRunAt: { lte: now } },
      { status: 'RETRY_WAIT', nextRunAt: { lte: now } },
      { status: { in: ['CLAIMED', 'RUNNING'] as JobStatus[] }, leaseExpiresAt: { lt: now } },
    ],
  };
}

/**
 * Attempts to claim ONE due job for `jobKey`. Returns `null` if nothing is
 * claimable, or if another worker won a race for the same candidate row
 * between this call's read and its conditional write.
 */
export async function claimJob(jobKey: string, workerId: string, leaseDurationMs = DEFAULT_LEASE_MS): Promise<Job | null> {
  const now = new Date();
  const candidate = await prisma.job.findFirst({
    where: { jobKey, ...claimableWhere(now) },
    orderBy: { nextRunAt: 'asc' },
  });
  if (!candidate) return null;

  const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
  const result = await prisma.job.updateMany({
    where: { id: candidate.id, ...claimableWhere(now) },
    data: { status: 'CLAIMED', leaseOwner: workerId, leaseExpiresAt },
  });
  if (result.count !== 1) return null; // lost the race, or state moved underneath us

  return prisma.job.findUniqueOrThrow({ where: { id: candidate.id } });
}

/** CLAIMED -> RUNNING, conditional on this worker still holding the lease. */
export async function startJob(jobId: string, workerId: string): Promise<boolean> {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: 'CLAIMED', leaseOwner: workerId },
    data: { status: 'RUNNING' },
  });
  return result.count === 1;
}

/** RUNNING -> SUCCEEDED, conditional on this worker still holding the lease. */
export async function completeJob(jobId: string, workerId: string): Promise<boolean> {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: 'RUNNING', leaseOwner: workerId },
    data: { status: 'SUCCEEDED', completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
  });
  return result.count === 1;
}

function backoffMs(attempts: number): number {
  return Math.min(30_000, 1000 * 2 ** attempts);
}

/**
 * RUNNING -> RETRY_WAIT (if attempts remain) or FAILED (dead-letter, once
 * `maxAttempts` is exhausted). Only the current lease owner may call this —
 * enforced the same way as `startJob`/`completeJob`.
 */
export async function failJob(jobId: string, workerId: string, errorMessage: string): Promise<{ terminal: boolean } | null> {
  const current = await prisma.job.findFirst({ where: { id: jobId, status: 'RUNNING', leaseOwner: workerId } });
  if (!current) return null; // lease already lost — nothing to record

  const newAttempts = current.attempts + 1;
  const terminal = newAttempts >= current.maxAttempts;
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: 'RUNNING', leaseOwner: workerId },
    data: terminal
      ? { status: 'FAILED', attempts: newAttempts, lastError: errorMessage, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null }
      : { status: 'RETRY_WAIT', attempts: newAttempts, lastError: errorMessage, nextRunAt: new Date(Date.now() + backoffMs(newAttempts)), leaseOwner: null, leaseExpiresAt: null },
  });
  if (result.count !== 1) return null; // lease lost between the read above and this write

  return { terminal };
}

export type JobHandler = (job: Job) => Promise<void>;

const JOB_HANDLERS = new Map<string, JobHandler>();

/** Registers the real business logic a claimed job of this `jobKey` should run. */
export function registerJobHandler(jobKey: string, handler: JobHandler): void {
  JOB_HANDLERS.set(jobKey, handler);
}

export interface WorkerTickResult {
  claimed: boolean;
  jobId?: string;
  outcome?: 'SUCCEEDED' | 'RETRY_WAIT' | 'FAILED';
}

/**
 * One worker "tick": claim the next due job for `jobKey` (if any), run its
 * registered handler, and record the outcome. This is the real function a
 * worker process loop or a manually-invoked CLI would call repeatedly.
 */
export async function runWorkerTick(jobKey: string, workerId: string, leaseDurationMs = DEFAULT_LEASE_MS): Promise<WorkerTickResult> {
  const job = await claimJob(jobKey, workerId, leaseDurationMs);
  if (!job) return { claimed: false };

  const started = await startJob(job.id, workerId);
  if (!started) return { claimed: false }; // lease lost immediately after claim (extremely narrow window)

  const handler = JOB_HANDLERS.get(jobKey);
  if (!handler) {
    await failJob(job.id, workerId, `No handler registered for jobKey "${jobKey}".`);
    logJobOutcome(job.id, jobKey, workerId, 'FAILED');
    return { claimed: true, jobId: job.id, outcome: 'FAILED' };
  }

  try {
    await handler(job);
    await completeJob(job.id, workerId);
    logJobOutcome(job.id, jobKey, workerId, 'SUCCEEDED');
    return { claimed: true, jobId: job.id, outcome: 'SUCCEEDED' };
  } catch (err) {
    const failResult = await failJob(job.id, workerId, err instanceof Error ? err.message : String(err));
    const outcome = failResult?.terminal ? 'FAILED' : 'RETRY_WAIT';
    logJobOutcome(job.id, jobKey, workerId, outcome);
    return { claimed: true, jobId: job.id, outcome };
  }
}

/**
 * Phase 27 Section 16: real correlation-ready job logging — the same
 * structured-JSON-line convention request-logger.ts uses for HTTP
 * requests (requestId/userId/workspaceId), here keyed by jobId/jobKey so
 * job execution can be traced the same way. Never logs `payload` (may
 * contain business data), only identifiers and the outcome.
 */
function logJobOutcome(jobId: string, jobKey: string, workerId: string, outcome: WorkerTickResult['outcome']): void {
  console.log(JSON.stringify({ level: outcome === 'FAILED' ? 'error' : outcome === 'RETRY_WAIT' ? 'warn' : 'info', jobId, jobKey, workerId, outcome, timestamp: new Date().toISOString() }));
}

export async function getJobById(jobId: string): Promise<Job | null> {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export async function getQueueDepth(jobKey: string, statuses: JobStatus[] = ['PENDING', 'RETRY_WAIT']): Promise<number> {
  return prisma.job.count({ where: { jobKey, status: { in: statuses } } });
}
