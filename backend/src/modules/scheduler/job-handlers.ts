import { registerJobHandler } from './job-queue.service';
import { runMonthlyCreditGrantForAllDueWorkspaces } from '../billing/scheduler.service';

/**
 * Phase 27: wires the generic job queue (job-queue.service.ts) to one real
 * piece of business logic, so the queue is proven against genuine work, not
 * only synthetic test handlers. The per-workspace exactly-once guarantee
 * for the credit grant itself is still Phase 26's proven `ScheduledJobRun`
 * unique constraint (unchanged) — this handler just gives the generic queue
 * a real, idempotent, safe-to-retry unit of work to drive on a schedule.
 */
export const CREDIT_GRANT_SWEEP_JOB_KEY = 'credit-grant-sweep';

export function registerProductionJobHandlers(): void {
  registerJobHandler(CREDIT_GRANT_SWEEP_JOB_KEY, async () => {
    await runMonthlyCreditGrantForAllDueWorkspaces();
  });
}
