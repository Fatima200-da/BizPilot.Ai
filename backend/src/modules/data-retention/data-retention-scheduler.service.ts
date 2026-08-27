import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { enqueueJob, registerJobHandler } from '../scheduler/job-queue.service';
import { computeNextRunAt } from '../scheduler/scheduled-workflow.service';
import { runDataRetentionPurge } from './data-retention.service';

/**
 * Phase 33 Track C: wires the weekly retention purge to the same real,
 * already-certified job-scheduler machinery backups already use (Phase
 * 27/28/31) — same two-layer duplicate-prevention (CAS on `nextRunAt` +
 * the Job's real unique `(jobKey, dedupeKey)` constraint), same missed-run
 * coalescing, same real DST-safe scheduling via `computeNextRunAt`.
 */
export const RETENTION_PURGE_JOB_KEY = 'data-retention-purge';
export const DEFAULT_RETENTION_SCHEDULE_NAME = 'weekly-data-retention-purge';

const MAX_COALESCE_ITERATIONS = 100_000;

export function registerRetentionPurgeJobHandler(): void {
  registerJobHandler(RETENTION_PURGE_JOB_KEY, async () => {
    await runDataRetentionPurge({ triggerType: 'SCHEDULED' });
  });
}

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 4, minute: 0 };
}

/** Idempotent: creates the default weekly schedule only if it doesn't already exist — safe to call on every process startup. */
export async function ensureDefaultRetentionSchedule(): Promise<void> {
  const existing = await prisma.dataRetentionSchedule.findUnique({ where: { name: DEFAULT_RETENTION_SCHEDULE_NAME } });
  if (existing) return;

  const { hour, minute } = parseTimeOfDay(env.DATA_RETENTION_SCHEDULE_TIME);
  const now = new Date();
  let nextRunAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  if (nextRunAt <= now) nextRunAt = new Date(nextRunAt.getTime() + 24 * 60 * 60 * 1000);

  await prisma.dataRetentionSchedule.create({
    data: { name: DEFAULT_RETENTION_SCHEDULE_NAME, intervalHours: 168, timeOfDay: env.DATA_RETENTION_SCHEDULE_TIME, timezone: 'UTC', enabled: true, nextRunAt },
  });
}

export interface RetentionSchedulerTickSummary {
  dueCount: number;
  claimedCount: number;
  enqueuedCount: number;
  coalescedCount: number;
}

export async function tickRetentionScheduler(now: Date = new Date()): Promise<RetentionSchedulerTickSummary> {
  const due = await prisma.dataRetentionSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });

  const summary: RetentionSchedulerTickSummary = { dueCount: due.length, claimedCount: 0, enqueuedCount: 0, coalescedCount: 0 };

  for (const schedule of due) {
    const occurrence = schedule.nextRunAt;

    const intervalDays = Math.max(1, Math.round(schedule.intervalHours / 24));
    const scheduleForCompute = { intervalUnit: 'DAY' as const, intervalValue: intervalDays, timeOfDay: schedule.timeOfDay, dayOfWeek: null, timezone: schedule.timezone };
    let newNextRunAt = computeNextRunAt(scheduleForCompute, occurrence);
    let iterations = 0;
    while (newNextRunAt <= now && iterations < MAX_COALESCE_ITERATIONS) {
      newNextRunAt = computeNextRunAt(scheduleForCompute, newNextRunAt);
      summary.coalescedCount += 1;
      iterations += 1;
    }

    const claim = await prisma.dataRetentionSchedule.updateMany({
      where: { id: schedule.id, nextRunAt: occurrence },
      data: { nextRunAt: newNextRunAt, lastRunAt: now, lastRunStatus: 'ENQUEUED' },
    });
    if (claim.count !== 1) continue;
    summary.claimedCount += 1;

    const dedupeKey = `${schedule.id}:${occurrence.toISOString().slice(0, 10)}`;
    const { created } = await enqueueJob({ jobKey: RETENTION_PURGE_JOB_KEY, dedupeKey, payload: { retentionScheduleId: schedule.id } });
    if (created) summary.enqueuedCount += 1;

    console.log(JSON.stringify({
      level: 'info',
      event: 'retention_scheduler.claimed',
      retentionScheduleId: schedule.id,
      occurrence: occurrence.toISOString(),
      nextRunAt: newNextRunAt.toISOString(),
      enqueued: created,
      timestamp: new Date().toISOString(),
    }));
  }

  console.log(JSON.stringify({ level: 'info', event: 'retention_scheduler.tick_complete', ...summary, timestamp: new Date().toISOString() }));
  return summary;
}
