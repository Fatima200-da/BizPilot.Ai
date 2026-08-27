/**
 * Phase 28 Track A: the real, invokable scheduler process. Like Phase
 * 27's `run-job-worker.ts`, this is NOT wired to any process supervisor
 * (systemd, Kubernetes, a hosted cron) in this environment — no such
 * infrastructure exists in this codebase. A real deployment runs this as a
 * long-lived process (or invokes `--once` periodically via whatever the
 * hosting platform provides); `tickScheduler`'s own claim/CAS logic
 * (scheduler-tick.service.ts) makes it safe to run MULTIPLE INSTANCES of
 * this exact script concurrently — that is the real, tested guarantee
 * (Section 6), not merely a single-instance assumption.
 *
 * This process also runs the worker side of the pipeline (claiming and
 * executing the `scheduled-workflow-run` jobs it just enqueued) — scheduler
 * and worker are separate FUNCTIONS with separate responsibilities
 * (tickScheduler only ever writes Jobs; runWorkerTick only ever claims and
 * executes them), but for this environment's simplicity they run in the
 * same OS process. A real production deployment can freely split them into
 * separate processes/containers without any code change — both functions
 * are already independent and network/process-topology-agnostic.
 *
 *   npx tsx src/scripts/run-scheduler.ts             # runs forever, ticking every 30s
 *   npx tsx src/scripts/run-scheduler.ts --once       # a single tick + drain, then exit (for cron/tests)
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/database/prisma';
import { tickScheduler, registerScheduledWorkflowHandler, SCHEDULED_WORKFLOW_JOB_KEY } from '../modules/scheduler/scheduler-tick.service';
import { runWorkerTick } from '../modules/scheduler/job-queue.service';
import { registerProductionJobHandlers } from '../modules/scheduler/job-handlers';
import { BACKUP_JOB_KEY, ensureDefaultBackupSchedule, registerBackupJobHandler, tickBackupScheduler } from '../modules/backup/backup-scheduler.service';
import { RETENTION_PURGE_JOB_KEY, ensureDefaultRetentionSchedule, registerRetentionPurgeJobHandler, tickRetentionScheduler } from '../modules/data-retention/data-retention-scheduler.service';
import { DATA_EXPORT_JOB_KEY, registerDataExportJobHandler } from '../modules/data-export/data-export-job.service';
// Phase 28 real defect, found via a real standalone Docker container run
// (not by any test — every test process happens to also load
// marketing-autopilot.routes.ts elsewhere in the same Vitest module graph,
// which masked this): this process never imports app.ts/routes.ts, so
// without this line the Workflow Engine's step-handler registry
// (step-handler.registry.ts) is empty here, and every real scheduled
// workflow execution fails with "No step handlers registered ..." on its
// first attempt — then silently reports SUCCEEDED on retry (see
// workflow-engine.service.ts's matching fix) while the instance is
// permanently stuck at PENDING. Side-effect import, same pattern already
// used by marketing-autopilot.routes.ts itself.
import '../modules/marketing-autopilot/marketing-autopilot.steps';

const TICK_INTERVAL_MS = 30_000;

function logEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...data, timestamp: new Date().toISOString() }));
}

async function runOnce(workerId: string): Promise<void> {
  const tick = await tickScheduler();
  logEvent('scheduler.tick', { ...tick });

  const backupTick = await tickBackupScheduler();
  logEvent('backup_scheduler.tick', { ...backupTick });

  const retentionTick = await tickRetentionScheduler();
  logEvent('retention_scheduler.tick', { ...retentionTick });

  // Drain every due job this tick enqueued (and any left over from a prior
  // tick/crash) — a bounded loop, not unbounded, so one pathological
  // backlog can't stall the process forever.
  for (let i = 0; i < 50; i += 1) {
    // sequential drain — each claim must complete before the next is attempted
    const result = await runWorkerTick(SCHEDULED_WORKFLOW_JOB_KEY, workerId);
    if (!result.claimed) break;
    logEvent('scheduler.job_outcome', { jobId: result.jobId, outcome: result.outcome });
  }

  // Same bounded drain for the backup job key — a distinct jobKey, so a
  // backlog of one type can never starve the other.
  for (let i = 0; i < 5; i += 1) {
    const result = await runWorkerTick(BACKUP_JOB_KEY, workerId, 20 * 60_000); // a full DB dump can genuinely take minutes — a longer lease than the default 30s
    if (!result.claimed) break;
    logEvent('backup_scheduler.job_outcome', { jobId: result.jobId, outcome: result.outcome });
  }

  for (let i = 0; i < 5; i += 1) {
    const result = await runWorkerTick(RETENTION_PURGE_JOB_KEY, workerId, 10 * 60_000);
    if (!result.claimed) break;
    logEvent('retention_scheduler.job_outcome', { jobId: result.jobId, outcome: result.outcome });
  }

  for (let i = 0; i < 10; i += 1) {
    const result = await runWorkerTick(DATA_EXPORT_JOB_KEY, workerId, 10 * 60_000);
    if (!result.claimed) break;
    logEvent('data_export.job_outcome', { jobId: result.jobId, outcome: result.outcome });
  }
}

async function main(): Promise<void> {
  registerScheduledWorkflowHandler();
  registerProductionJobHandlers();
  registerBackupJobHandler();
  await ensureDefaultBackupSchedule();
  registerRetentionPurgeJobHandler();
  await ensureDefaultRetentionSchedule();
  registerDataExportJobHandler();
  const workerId = `scheduler-${randomUUID()}`;
  logEvent('scheduler.started', { workerId });

  if (process.argv.includes('--once')) {
    await runOnce(workerId);
    await prisma.$disconnect();
    return;
  }

  // A real long-running scheduler loop, intentionally infinite until the
  // process is stopped — sequential by design (tick, wait, tick again).
  for (;;) {
    await runOnce(workerId);
    await new Promise((resolve) => setTimeout(resolve, TICK_INTERVAL_MS));
  }
}

main().catch(async (err: unknown) => {
  console.error(JSON.stringify({ level: 'error', event: 'scheduler.fatal', message: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() }));
  await prisma.$disconnect();
  process.exit(1);
});
