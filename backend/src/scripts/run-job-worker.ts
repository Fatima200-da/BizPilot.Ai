/**
 * Phase 27 Section 4: the real, invokable entry point for the generic job
 * worker. Like Phase 26's `run-monthly-credit-grants.ts`, this is NOT wired
 * to any cron/task-scheduler in this environment — no such infrastructure
 * exists in this codebase. A real deployment would run this in a loop (or
 * invoke it periodically via whatever scheduler the hosting platform
 * provides) so due jobs get claimed and executed; claim/lease/retry/backoff
 * semantics (job-queue.service.ts) make it safe to invoke concurrently from
 * multiple worker processes.
 *
 *   npx tsx src/scripts/run-job-worker.ts <jobKey>
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../infrastructure/database/prisma';
import { runWorkerTick } from '../modules/scheduler/job-queue.service';
import { registerProductionJobHandlers, CREDIT_GRANT_SWEEP_JOB_KEY } from '../modules/scheduler/job-handlers';

async function main(): Promise<void> {
  registerProductionJobHandlers();
  const jobKey = process.argv[2] ?? CREDIT_GRANT_SWEEP_JOB_KEY;
  const workerId = `cli-worker-${randomUUID()}`;
  const result = await runWorkerTick(jobKey, workerId);
  console.log('Job worker tick complete:', JSON.stringify(result));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error('Job worker tick failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
