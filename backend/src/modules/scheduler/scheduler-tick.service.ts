import { prisma } from '../../infrastructure/database/prisma';
import { enqueueJob, registerJobHandler } from './job-queue.service';
import { computeNextRunAt } from './scheduled-workflow.service';
import { startWorkflow } from '../workflows/workflow-engine.service';
import { createNotification } from '../notifications/notification.service';
import { resolveNotificationRecipient } from '../billing/subscription.service';

/**
 * Phase 28 Track A: the real scheduler tick — finds due `ScheduledWorkflow`
 * rows and turns each due occurrence into exactly one real `Job`
 * (job-queue.service.ts, Phase 27), which a worker then executes through
 * the existing, unmodified workflow engine. Scheduler and worker
 * responsibilities are deliberately separate: this module only ever reads
 * schedules and writes Jobs — it never runs a workflow step itself; that
 * remains `runWorkerTick`'s job (job-queue.service.ts), so a scheduler
 * instance dying mid-tick can never leave a workflow half-executed.
 *
 * Duplicate-execution prevention across concurrent scheduler instances is
 * a real two-layer guarantee:
 *   1. An optimistic-concurrency CAS on `ScheduledWorkflow.nextRunAt` — the
 *      claim UPDATE's WHERE clause pins the row's CURRENT nextRunAt value;
 *      only the scheduler instance that observes the pre-claim value wins,
 *      exactly the same class of guarantee proven for Job claims in Phase 27.
 *   2. Even if that somehow raced, the enqueued Job's real Postgres unique
 *      constraint on (jobKey, dedupeKey) — keyed by the exact occurrence
 *      timestamp — makes a second enqueue for the same occurrence a no-op.
 */
export const SCHEDULED_WORKFLOW_JOB_KEY = 'scheduled-workflow-run';

interface ScheduledWorkflowJobPayload {
  scheduledWorkflowId: string;
}

/** Registers the real handler a claimed `scheduled-workflow-run` Job executes — the actual, unmodified workflow engine, not a stub. */
export function registerScheduledWorkflowHandler(): void {
  registerJobHandler(SCHEDULED_WORKFLOW_JOB_KEY, async (job) => {
    const payload = job.payload as ScheduledWorkflowJobPayload | null;
    if (!payload?.scheduledWorkflowId) throw new Error('Scheduled-workflow job payload missing scheduledWorkflowId.');

    const schedule = await prisma.scheduledWorkflow.findUnique({ where: { id: payload.scheduledWorkflowId } });
    if (!schedule) throw new Error(`ScheduledWorkflow ${payload.scheduledWorkflowId} no longer exists (deleted after being enqueued).`);

    const instance = await startWorkflow({
      workspaceId: schedule.workspaceId,
      workflowDefinitionKey: schedule.workflowDefinitionKey,
      businessProfileId: schedule.businessProfileId ?? undefined,
      input: (schedule.input as Record<string, unknown> | null) ?? {},
      // Belt-and-suspenders: startWorkflow's OWN idempotency key, keyed by
      // the exact job dedupeKey (which already encodes the occurrence) — a
      // retried/duplicated job claim can never create a second WorkflowInstance.
      idempotencyKey: job.dedupeKey,
    });

    // Phase 29 real gap closed: workflow-engine.service.ts already fires a
    // generic WORKFLOW_COMPLETED notification when an instance reaches
    // real COMPLETED — this is a DISTINCT, scheduler-specific signal (the
    // user never triggered this run themselves, so "your workflow
    // completed" is less useful than "your scheduled automation ran on
    // its own"). Fired for COMPLETED and AWAITING_APPROVAL alike — most
    // real workflow definitions (marketing-autopilot included) have a
    // real human-approval gate, so "the scheduled run executed and is
    // now waiting on you" is the common real outcome, not an edge case.
    if (instance.status === 'COMPLETED' || instance.status === 'AWAITING_APPROVAL') {
      await createNotification({
        workspaceId: schedule.workspaceId,
        recipientUserId: await resolveNotificationRecipient(schedule.workspaceId, schedule.createdByUserId),
        category: 'AI',
        type: 'SCHEDULED_WORKFLOW_COMPLETED',
        title: `Scheduled automation "${schedule.name}" completed`,
        relatedEntityType: 'WorkflowInstance',
        relatedEntityId: instance.id,
      });
    }
  });
}

export interface SchedulerTickSummary {
  dueCount: number;
  claimedCount: number;
  enqueuedCount: number;
  coalescedCount: number; // occurrences skipped without running, because they were missed during downtime and a later occurrence already caught up past them
}

const MAX_SCHEDULES_PER_TICK = 100; // bounded batch — a production safeguard against unbounded per-tick work
const MAX_COALESCE_ITERATIONS = 100_000; // safety bound against a pathological/corrupted schedule looping forever

/**
 * One real scheduler tick. Safe to call concurrently from multiple
 * scheduler processes/instances (the whole point of Section 6's
 * requirement) and safe to call repeatedly after downtime — a schedule
 * that missed many occurrences while the scheduler was down fires exactly
 * ONE real run for the backlog, then coalesces straight to the next
 * genuine future occurrence, rather than replaying every missed tick (the
 * same "coalesce missed runs" policy real production schedulers use by
 * default).
 */
export async function tickScheduler(now: Date = new Date()): Promise<SchedulerTickSummary> {
  const due = await prisma.scheduledWorkflow.findMany({
    where: { enabled: true, nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    take: MAX_SCHEDULES_PER_TICK,
  });

  const summary: SchedulerTickSummary = { dueCount: due.length, claimedCount: 0, enqueuedCount: 0, coalescedCount: 0 };

  for (const schedule of due) {
    const occurrence = schedule.nextRunAt;

    let newNextRunAt = computeNextRunAt(
      { intervalUnit: schedule.intervalUnit, intervalValue: schedule.intervalValue, timeOfDay: schedule.timeOfDay, dayOfWeek: schedule.dayOfWeek, timezone: schedule.timezone },
      occurrence
    );
    // Missed-job recovery / coalescing: if the schedule was down long enough
    // that even the freshly-computed next occurrence is still in the past,
    // keep advancing (without enqueuing anything for those skipped
    // occurrences) until we reach a genuine future slot.
    let iterations = 0;
    while (newNextRunAt <= now && iterations < MAX_COALESCE_ITERATIONS) {
      newNextRunAt = computeNextRunAt(
        { intervalUnit: schedule.intervalUnit, intervalValue: schedule.intervalValue, timeOfDay: schedule.timeOfDay, dayOfWeek: schedule.dayOfWeek, timezone: schedule.timezone },
        newNextRunAt
      );
      summary.coalescedCount += 1;
      iterations += 1;
    }

    // The real duplicate-prevention CAS: only the caller that observes
    // `nextRunAt` still equal to the value we read above may advance it.
    // sequential per-schedule claim within one tick — the CAS below is what
    // makes this correct under concurrency, not parallelism here.
    const claim = await prisma.scheduledWorkflow.updateMany({
      where: { id: schedule.id, nextRunAt: occurrence },
      data: { nextRunAt: newNextRunAt, lastRunAt: now, lastRunStatus: 'ENQUEUED' },
    });
    if (claim.count !== 1) continue; // another scheduler instance already claimed this exact occurrence
    summary.claimedCount += 1;

    const dedupeKey = `${schedule.id}:${occurrence.toISOString()}`;
    const { created } = await enqueueJob({ jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey, payload: { scheduledWorkflowId: schedule.id } });
    if (created) summary.enqueuedCount += 1;

    // Section 8: real scheduling-event logging — identifiers only, never
    // `input`/payload content (may contain business data), never secrets.
    console.log(JSON.stringify({
      level: 'info',
      event: 'scheduler.claimed',
      scheduledWorkflowId: schedule.id,
      workspaceId: schedule.workspaceId,
      occurrence: occurrence.toISOString(),
      nextRunAt: newNextRunAt.toISOString(),
      enqueued: created,
      timestamp: new Date().toISOString(),
    }));
  }

  console.log(JSON.stringify({ level: 'info', event: 'scheduler.tick_complete', ...summary, timestamp: new Date().toISOString() }));
  return summary;
}
