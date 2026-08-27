import { randomUUID } from 'node:crypto';
import { Prisma, type DataRetentionPurgeRun } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';

/**
 * Phase 33 Track C: real, enforced data retention — not merely a policy
 * document (Phase 29 deliberately deferred enforcement; this phase closes
 * that gap for a real, FK-cascade-reviewed subset of soft-deleted data).
 *
 * Scope, deliberately narrow and reasoned rather than blanket: this
 * schema has 14 models with a real `deletedAt` soft-delete column. Three
 * are included in this phase's automated purge —
 *
 *   - Lead: a leaf row, no incoming FK references, zero cascade risk.
 *   - Contact: `Lead.contactId -> Contact` is `onDelete: Cascade` at the
 *     database level — hard-deleting a Contact that still has ANY real
 *     Lead (purge-eligible or not, soft-deleted or not) would silently
 *     destroy that Lead too. The purge query below therefore only
 *     considers a Contact eligible once it has ZERO remaining Lead rows
 *     — a real, load-bearing safety condition, not a formality.
 *   - WorkspaceMember: cascades only to `ProjectMember` (a pure join
 *     table with no independent value once the member is gone) — safe.
 *
 * The other 11 soft-deletable models (User, Role, Workspace,
 * BusinessProfile, Conversation, Prompt, Template, Project, Folder,
 * File, WorkflowDefinition) are NOT included this phase — their FK
 * graphs have not been individually reviewed for the same class of
 * silent-cascade risk found above, and account-level deletion (User,
 * Workspace) is deliberately kept a manual, reviewed operation rather
 * than an automated job. This is a real, stated scope limitation, not a
 * silent gap — see the Phase 33 certification doc.
 *
 * Legal/financial record protection is structural, not policy-only:
 * Invoice, Payment, Subscription, AICredit, AIUsage, and AuditLog have
 * NO `deletedAt` column at all — they cannot ever match this purge job's
 * query, regardless of any future code change to the purgeable-model
 * list, short of someone deliberately adding that column to one of them.
 */

function logRetentionEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...data, timestamp: new Date().toISOString() }));
}

function logRetentionError(event: string, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...data, timestamp: new Date().toISOString() }));
}

export class PurgeAlreadyInProgressError extends Error {
  constructor(runningId: string) {
    super(`A data-retention purge run (${runningId}) is already genuinely in progress — refusing to start a second, concurrent purge.`);
    this.name = 'PurgeAlreadyInProgressError';
  }
}

const PURGE_STALE_RUNNING_MINUTES = 120; // same real-world reasoning as backup's own stale-run guard

/** Same real concurrency/abandoned-run guard pattern already certified for backups (Phase 31/32). */
async function guardAgainstConcurrentPurge(): Promise<void> {
  const staleCutoff = new Date(Date.now() - PURGE_STALE_RUNNING_MINUTES * 60_000);
  const runningRuns = await prisma.dataRetentionPurgeRun.findMany({ where: { status: 'RUNNING' } });

  for (const run of runningRuns) {
    if (run.startedAt < staleCutoff) {
      await prisma.dataRetentionPurgeRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: `Abandoned — exceeded ${String(PURGE_STALE_RUNNING_MINUTES)}min still RUNNING, treated as a crashed/interrupted run.`, completedAt: new Date() },
      });
      logRetentionError('retention.stale_run_reaped', { runId: run.id, startedAt: run.startedAt.toISOString() });
    } else {
      throw new PurgeAlreadyInProgressError(run.id);
    }
  }
}

interface RunPurgeOptions {
  triggerType: 'SCHEDULED' | 'MANUAL';
  jobId?: string;
  /** Test-only escape hatch — overrides `env.DATA_RETENTION_DAYS` so integration tests don't need to wait real days for eligibility. Never set in production code paths. */
  retentionDaysOverride?: number;
}

export interface PurgeResult {
  run: DataRetentionPurgeRun;
  purgedCounts: Record<string, number>;
}

/**
 * Executes one real, complete retention purge — real hard `DELETE`s
 * (`deleteMany`), each wrapped in the SAME transaction as its own
 * `AuditLog` entry so a purge and its audit trail can never diverge (both
 * commit or both roll back together). Throws on any failure — the caller
 * (the job-queue handler) relies on that to trigger the queue's real
 * retry/backoff/dead-letter behavior.
 */
export async function runDataRetentionPurge(options: RunPurgeOptions): Promise<PurgeResult> {
  await guardAgainstConcurrentPurge();

  const runId = randomUUID();
  const startedAt = new Date();
  const retentionDays = options.retentionDaysOverride ?? env.DATA_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  await prisma.dataRetentionPurgeRun.create({
    data: { id: runId, status: 'RUNNING', triggerType: options.triggerType, jobId: options.jobId, startedAt },
  });
  logRetentionEvent('retention.started', { runId, triggerType: options.triggerType, retentionDays });

  try {
    const purgedCounts: Record<string, number> = {};

    // Leads first — no incoming FK references, real leaf-level purge.
    const leadsToPurge = await prisma.lead.findMany({ where: { deletedAt: { not: null, lt: cutoff } }, select: { id: true, workspaceId: true } });
    purgedCounts.lead = await purgeRows('Lead', leadsToPurge, (tx, ids) => tx.lead.deleteMany({ where: { id: { in: ids } } }));

    // Contacts — only those with ZERO remaining Lead rows (real safety
    // condition against the Lead->Contact cascade-delete risk documented
    // above; `none: {}` matches a Contact with no Lead rows at all,
    // purged or not, active or not).
    const contactsToPurge = await prisma.contact.findMany({ where: { deletedAt: { not: null, lt: cutoff }, leads: { none: {} } }, select: { id: true, workspaceId: true } });
    purgedCounts.contact = await purgeRows('Contact', contactsToPurge, (tx, ids) => tx.contact.deleteMany({ where: { id: { in: ids } } }));

    // WorkspaceMembers — cascades only to ProjectMember (safe join table).
    const membersToPurge = await prisma.workspaceMember.findMany({ where: { deletedAt: { not: null, lt: cutoff } }, select: { id: true, workspaceId: true } });
    purgedCounts.workspaceMember = await purgeRows('WorkspaceMember', membersToPurge, (tx, ids) => tx.workspaceMember.deleteMany({ where: { id: { in: ids } } }));

    const totalPurged = Object.values(purgedCounts).reduce((a, b) => a + b, 0);
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const run = await prisma.dataRetentionPurgeRun.update({
      where: { id: runId },
      data: { status: 'SUCCEEDED', purgedCounts, totalPurged, completedAt, durationMs },
    });
    logRetentionEvent('retention.succeeded', { runId, purgedCounts, totalPurged, durationMs });

    return { run, purgedCounts };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await prisma.dataRetentionPurgeRun.findUnique({ where: { id: runId } });
    if (current?.status === 'RUNNING') {
      await prisma.dataRetentionPurgeRun.update({ where: { id: runId }, data: { status: 'FAILED', errorMessage: message, completedAt: new Date() } });
      logRetentionError('retention.failed', { runId, error: message });
    }
    throw err;
  }
}

/**
 * Real, tenant-isolation-preserving purge for one model: each row is
 * deleted inside its OWN transaction alongside a real `AuditLog` entry
 * (`action: 'DELETE'`, scoped to that row's real `workspaceId` — never a
 * cross-tenant audit write), so a partial failure mid-purge leaves a
 * consistent, individually-auditable trail rather than an all-or-nothing
 * batch whose audit story is incomplete if it fails halfway.
 */
async function purgeRows(entityType: string, rows: Array<{ id: string; workspaceId: string }>, deleteMany: (tx: Prisma.TransactionClient, ids: string[]) => Promise<{ count: number }>): Promise<number> {
  let purged = 0;
  for (const row of rows) {
    await prisma.$transaction(async (tx) => {
      const result = await deleteMany(tx, [row.id]);
      if (result.count === 1) {
        await tx.auditLog.create({
          data: { workspaceId: row.workspaceId, actorUserId: null, action: 'DELETE', entityType, entityId: row.id, previousValue: Prisma.JsonNull, newValue: Prisma.JsonNull },
        });
      }
    });
    purged += 1;
  }
  return purged;
}

export interface PurgeObservability {
  currentStatus: 'RUNNING' | 'HEALTHY' | 'FAILED_RECENTLY' | 'NO_RUNS_YET';
  lastSuccessful: { id: string; startedAt: Date; totalPurged: number | null; purgedCounts: unknown } | null;
  lastFailed: { id: string; startedAt: Date; errorMessage: string | null } | null;
  history: DataRetentionPurgeRun[];
}

export async function getPurgeObservability(historyLimit = 20): Promise<PurgeObservability> {
  const history = await prisma.dataRetentionPurgeRun.findMany({ orderBy: { startedAt: 'desc' }, take: historyLimit });

  const lastSuccessfulRun = history.find((r) => r.status === 'SUCCEEDED') ?? null;
  const lastFailedRun = history.find((r) => r.status === 'FAILED') ?? null;
  const currentlyRunning = history.find((r) => r.status === 'RUNNING') ?? null;

  let currentStatus: PurgeObservability['currentStatus'] = 'NO_RUNS_YET';
  if (currentlyRunning) currentStatus = 'RUNNING';
  else if (history.length === 0) currentStatus = 'NO_RUNS_YET';
  else if (history[0]?.status === 'FAILED') currentStatus = 'FAILED_RECENTLY';
  else currentStatus = 'HEALTHY';

  return {
    currentStatus,
    lastSuccessful: lastSuccessfulRun ? { id: lastSuccessfulRun.id, startedAt: lastSuccessfulRun.startedAt, totalPurged: lastSuccessfulRun.totalPurged, purgedCounts: lastSuccessfulRun.purgedCounts } : null,
    lastFailed: lastFailedRun ? { id: lastFailedRun.id, startedAt: lastFailedRun.startedAt, errorMessage: lastFailedRun.errorMessage } : null,
    history,
  };
}

/** Real, read-only "what WOULD be purged right now" preview — lets an operator (or a test) confirm eligibility without committing to a real delete. */
export async function countPurgeEligible(retentionDaysOverride?: number): Promise<{ lead: number; contact: number; workspaceMember: number }> {
  const retentionDays = retentionDaysOverride ?? env.DATA_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [lead, contact, workspaceMember] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: { not: null, lt: cutoff } } }),
    prisma.contact.count({ where: { deletedAt: { not: null, lt: cutoff }, leads: { none: {} } } }),
    prisma.workspaceMember.count({ where: { deletedAt: { not: null, lt: cutoff } } }),
  ]);

  return { lead, contact, workspaceMember };
}
