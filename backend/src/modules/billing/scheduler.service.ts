import { prisma } from '../../infrastructure/database/prisma';
import { getCurrentSubscription, grantMonthlyCreditsIfDue } from './subscription.service';

/**
 * Phase 26 Section 8: closes the gap Phase 25 explicitly documented —
 * `grantMonthlyCreditsIfDue` existed but nothing called it safely under
 * concurrency or tracked whether it had run. This is a job-RUNNER
 * mechanism, not a cron daemon (no scheduler process is started or claimed
 * to run automatically — see `src/scripts/run-monthly-credit-grants.ts`
 * for the real, invokable entry point a real cron/task-scheduler would
 * call; none is wired up in this environment, which is accurately reported
 * as a known limitation, not silently assumed).
 *
 * The actual concurrency guarantee is the real Postgres unique constraint
 * on `ScheduledJobRun(jobKey, dedupeKey)` — the same proven pattern as
 * Phase 25's `WebhookEvent`. `dedupeKey` is `${workspaceId}:${periodStartISO}`,
 * so "same billing period + same workspace = exactly one grant" is a
 * database-enforced invariant, not an application-level assumption.
 */
const JOB_KEY = 'monthly-credit-grant';

export interface JobRunResult {
  ran: boolean;
  granted: boolean;
  amount: number;
  reason?: string;
}

async function dedupeKeyFor(workspaceId: string): Promise<string> {
  const subscription = await getCurrentSubscription(workspaceId);
  return `${workspaceId}:${subscription.currentPeriodStart.toISOString()}`;
}

/**
 * Attempts to claim the job slot for this (workspace, period). Returns the
 * claimed row if this call won the race, or `null` if another execution
 * already owns it (RUNNING) or already completed it (SUCCEEDED) — in both
 * `null` cases, the caller must NOT proceed to grant credits.
 */
async function claimJobSlot(dedupeKey: string): Promise<{ id: string } | null> {
  try {
    const created = await prisma.scheduledJobRun.create({
      data: { jobKey: JOB_KEY, dedupeKey, status: 'RUNNING' },
    });
    return { id: created.id };
  } catch (err) {
    const isUniqueViolation = err instanceof Error && 'code' in err && ((err as { code?: string }).code === 'P2002' || (err as { code?: string }).code === '23505');
    if (!isUniqueViolation) throw err;

    const existing = await prisma.scheduledJobRun.findUniqueOrThrow({ where: { jobKey_dedupeKey: { jobKey: JOB_KEY, dedupeKey } } });
    if (existing.status === 'SUCCEEDED' || existing.status === 'RUNNING') {
      return null; // already done, or another execution owns it right now
    }
    // FAILED — attempt real, idempotent recovery: only proceed if THIS call
    // is the one that flips it back to RUNNING (a conditional update, not a
    // blind one — two concurrent recovery attempts must not both "win").
    const reclaimed = await prisma.scheduledJobRun.updateMany({
      where: { id: existing.id, status: 'FAILED' },
      data: { status: 'RUNNING', startedAt: new Date(), completedAt: null, error: null },
    });
    return reclaimed.count === 1 ? { id: existing.id } : null;
  }
}

/**
 * Runs the monthly credit grant for exactly one workspace, safe under
 * concurrent invocation for the SAME workspace (proven in
 * scheduler.integration.test.ts with 10 real concurrent Promise.all calls).
 */
export async function runMonthlyCreditGrantJob(workspaceId: string): Promise<JobRunResult> {
  const dedupeKey = await dedupeKeyFor(workspaceId);
  const claim = await claimJobSlot(dedupeKey);
  if (!claim) {
    return { ran: false, granted: false, amount: 0, reason: 'Already run or currently running for this workspace and period.' };
  }

  try {
    const result = await grantMonthlyCreditsIfDue(workspaceId);
    await prisma.scheduledJobRun.update({ where: { id: claim.id }, data: { status: 'SUCCEEDED', completedAt: new Date() } });
    return { ran: true, granted: result.granted, amount: result.amount };
  } catch (err) {
    await prisma.scheduledJobRun.update({
      where: { id: claim.id },
      data: { status: 'FAILED', completedAt: new Date(), error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

export interface BatchJobSummary {
  workspacesProcessed: number;
  grantsIssued: number;
  alreadyDone: number;
  failed: number;
}

/**
 * Runs the job across every workspace with a current subscription — the
 * function a real cron/task-scheduler trigger would call. Each workspace's
 * job is independent (one workspace's failure does not block the others).
 */
export async function runMonthlyCreditGrantForAllDueWorkspaces(): Promise<BatchJobSummary> {
  const workspaceIds = (
    await prisma.subscription.findMany({
      where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'] } },
      select: { workspaceId: true },
      distinct: ['workspaceId'],
    })
  ).map((s) => s.workspaceId);

  const summary: BatchJobSummary = { workspacesProcessed: 0, grantsIssued: 0, alreadyDone: 0, failed: 0 };
  for (const workspaceId of workspaceIds) {
    summary.workspacesProcessed += 1;
    try {
      // Sequential (not Promise.all) — correctness doesn't require it (each
      // workspace's job is independently locked) but it keeps this batch's
      // resource usage bounded and predictable for an operator running it manually.
      const result = await runMonthlyCreditGrantJob(workspaceId);
      if (result.ran && result.granted) summary.grantsIssued += 1;
      else if (!result.ran) summary.alreadyDone += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

/** Observability (Section 8: "observable job state") — real query, not a log-scraping approximation. */
export async function getJobRunHistory(jobKey: string = JOB_KEY, limit = 50): Promise<Array<{ id: string; dedupeKey: string; status: string; startedAt: Date; completedAt: Date | null; error: string | null }>> {
  const rows = await prisma.scheduledJobRun.findMany({ where: { jobKey }, orderBy: { startedAt: 'desc' }, take: Math.min(limit, 200) });
  return rows;
}
