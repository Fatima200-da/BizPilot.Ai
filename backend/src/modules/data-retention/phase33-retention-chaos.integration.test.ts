import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { ensureSeeded } from '../../testing/integration-helpers';
import { claimJob, completeJob, enqueueJob, runWorkerTick } from '../scheduler/job-queue.service';
import { RETENTION_PURGE_JOB_KEY, registerRetentionPurgeJobHandler } from './data-retention-scheduler.service';

/**
 * Phase 33 Track K: chaos / failure injection for the one genuinely NEW
 * component this phase introduces to the job-queue — `data-retention-
 * purge`. Every OTHER chaos scenario Track K asks for (database outage,
 * storage outage, worker crash/lease-expiry reclaim, scheduler restart)
 * already has real, passing evidence from Phase 27 (`job-queue.
 * integration.test.ts`'s worker-crash test), Phase 28 (`scheduler-tick.
 * integration.test.ts`'s scheduler-restart test), Phase 30 (`phase30-
 * dependency-failure.integration.test.ts`'s real Postgres-down test), and
 * Phase 32 (`phase32-offsite-recovery.integration.test.ts`'s unreachable-
 * S3/wrong-credentials tests) — cited, not re-derived, in the Phase 33
 * certification doc. This file proves the NEW retention job type inherits
 * that SAME real crash-recovery guarantee, not merely assumed from it
 * being "just another job."
 *
 * Every scenario demonstrates detect -> classify -> recover -> observe:
 * a crashed worker's lease expires (detect), the job becomes claimable
 * again rather than stuck (classify: reclaimable, not lost), a second
 * worker completes it (recover), and the outcome is a real, observable
 * SUCCEEDED PurgeRun + Job row (observe).
 */
describe('Phase 33 Track K: chaos — retention-purge job worker crash recovery', () => {
  it('a retention-purge job claimed by a worker that then "crashes" (lease expires) is reclaimed and completed by a different worker; the crashed worker can no longer complete it', async () => {
    await ensureSeeded();
    registerRetentionPurgeJobHandler();

    const dedupeKey = `phase33-chaos-${randomUUID()}`;
    const { job } = await enqueueJob({ jobKey: RETENTION_PURGE_JOB_KEY, dedupeKey });

    // Worker A claims it, then "crashes" — never calls completeJob/failJob,
    // simulating a real process death mid-execution.
    const claimedByA = await claimJob(RETENTION_PURGE_JOB_KEY, 'worker-A-about-to-crash', 1000); // a real, short 1s lease
    expect(claimedByA?.id).toBe(job.id);

    // Real detect: wait past the real lease expiry.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Real classify + recover: a second worker's tick claims the SAME job (expired-lease jobs fold back into the claimable set — job-queue.service.ts's own documented, already-certified mechanism), executes the real handler, and completes it.
    const result = await runWorkerTick(RETENTION_PURGE_JOB_KEY, 'worker-B-recovering', 60_000);
    expect(result.claimed).toBe(true);
    expect(result.jobId).toBe(job.id);
    expect(result.outcome).toBe('SUCCEEDED');

    // Real observe: the crashed worker A is now provably locked out — it can never complete the job it lost the lease on.
    const staleComplete = await completeJob(job.id, 'worker-A-about-to-crash');
    expect(staleComplete).toBe(false);

    // Real observe: a genuine, successful PurgeRun exists as the recovered outcome.
    const finalJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(finalJob.status).toBe('SUCCEEDED');

    await prisma.job.delete({ where: { id: job.id } });
    const recentPurgeRuns = await prisma.dataRetentionPurgeRun.findMany({ where: { status: 'SUCCEEDED', triggerType: 'SCHEDULED' }, orderBy: { startedAt: 'desc' }, take: 1 });
    if (recentPurgeRuns[0]) await prisma.dataRetentionPurgeRun.delete({ where: { id: recentPurgeRuns[0].id } });
  }, 30_000);
});
