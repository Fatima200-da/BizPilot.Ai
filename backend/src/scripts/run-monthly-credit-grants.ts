/**
 * Phase 26 Section 8: the real, invokable entry point for the monthly
 * credit-grant job. This script is NOT wired to any cron/task-scheduler in
 * this environment — no such infrastructure exists in this codebase (an
 * honest, previously-documented limitation, not silently assumed away).
 * A real deployment would invoke this on a daily (or more frequent)
 * schedule via whatever scheduler the hosting platform provides (a
 * Kubernetes CronJob, a hosted cron service, etc.) — the job itself is
 * idempotent and concurrency-safe (scheduler.service.ts), so it is safe to
 * invoke more often than strictly necessary.
 *
 *   npx tsx src/scripts/run-monthly-credit-grants.ts
 */
import { prisma } from '../infrastructure/database/prisma';
import { runMonthlyCreditGrantForAllDueWorkspaces } from '../modules/billing/scheduler.service';

async function main(): Promise<void> {
  const summary = await runMonthlyCreditGrantForAllDueWorkspaces();
  console.log('Monthly credit grant job run complete:', JSON.stringify(summary));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err: unknown) => {
    console.error('Monthly credit grant job failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
