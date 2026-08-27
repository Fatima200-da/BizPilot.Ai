import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { enqueueJob, registerJobHandler } from '../scheduler/job-queue.service';
import { computeNextRunAt } from '../scheduler/scheduled-workflow.service';
import { runDatabaseBackup } from './backup.service';

/**
 * Phase 31 Track E: wires the daily database backup to the real,
 * already-certified job-scheduler machinery (Phase 27/28). Deliberately
 * mirrors `scheduler-tick.service.ts`'s `tickScheduler()` pattern exactly
 * — same two-layer duplicate-prevention guarantee (an optimistic-
 * concurrency CAS on `nextRunAt`, plus the enqueued Job's real unique
 * `(jobKey, dedupeKey)` constraint as a second, independent layer), same
 * missed-run coalescing policy (a schedule that missed days of backups
 * while the scheduler was down fires exactly ONE catch-up backup, not one
 * per missed day) — rather than inventing a new scheduling primitive for
 * a mechanism this codebase has already proven correct.
 */
export const BACKUP_JOB_KEY = 'database-backup';
export const DEFAULT_BACKUP_SCHEDULE_NAME = 'daily-database-backup';

const MAX_COALESCE_ITERATIONS = 100_000; // same safety bound as scheduler-tick.service.ts

export function registerBackupJobHandler(): void {
  registerJobHandler(BACKUP_JOB_KEY, async () => {
    await runDatabaseBackup({ triggerType: 'SCHEDULED' });
  });
}

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : { hour: 3, minute: 0 };
}

/** Idempotent: creates the default daily schedule only if it doesn't already exist — safe to call on every process startup. */
export async function ensureDefaultBackupSchedule(): Promise<void> {
  const existing = await prisma.backupSchedule.findUnique({ where: { name: DEFAULT_BACKUP_SCHEDULE_NAME } });
  if (existing) return;

  const { hour, minute } = parseTimeOfDay(env.BACKUP_SCHEDULE_TIME);
  const now = new Date();
  let nextRunAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
  if (nextRunAt <= now) nextRunAt = new Date(nextRunAt.getTime() + 24 * 60 * 60 * 1000);

  await prisma.backupSchedule.create({
    data: { name: DEFAULT_BACKUP_SCHEDULE_NAME, intervalHours: 24, timeOfDay: env.BACKUP_SCHEDULE_TIME, timezone: 'UTC', enabled: true, nextRunAt },
  });
}

export interface BackupSchedulerTickSummary {
  dueCount: number;
  claimedCount: number;
  enqueuedCount: number;
  coalescedCount: number;
}

/**
 * One real backup-scheduler tick — safe to call concurrently from multiple
 * process instances, and safe to call repeatedly after downtime (the same
 * class of guarantee already proven for `tickScheduler()`, reused here
 * rather than re-derived).
 */
export async function tickBackupScheduler(now: Date = new Date()): Promise<BackupSchedulerTickSummary> {
  const due = await prisma.backupSchedule.findMany({ where: { enabled: true, nextRunAt: { lte: now } } });

  const summary: BackupSchedulerTickSummary = { dueCount: due.length, claimedCount: 0, enqueuedCount: 0, coalescedCount: 0 };

  for (const schedule of due) {
    const occurrence = schedule.nextRunAt;

    // Real DST-safe next-occurrence computation — reuses
    // scheduled-workflow.service.ts's already-proven `computeNextRunAt`
    // (luxon-backed, resolves wall-clock hour/minute against the real IANA
    // timezone for the SPECIFIC target date) rather than naive UTC-ms
    // arithmetic, which would silently drift by the DST delta for any
    // non-UTC schedule timezone. `intervalHours` must be a multiple of 24
    // for this DAY-unit computation — true for every schedule this phase
    // creates (`ensureDefaultBackupSchedule` always uses 24).
    const intervalDays = Math.max(1, Math.round(schedule.intervalHours / 24));
    const scheduleForCompute = { intervalUnit: 'DAY' as const, intervalValue: intervalDays, timeOfDay: schedule.timeOfDay, dayOfWeek: null, timezone: schedule.timezone };
    let newNextRunAt = computeNextRunAt(scheduleForCompute, occurrence);
    let iterations = 0;
    while (newNextRunAt <= now && iterations < MAX_COALESCE_ITERATIONS) {
      newNextRunAt = computeNextRunAt(scheduleForCompute, newNextRunAt);
      summary.coalescedCount += 1;
      iterations += 1;
    }

    const claim = await prisma.backupSchedule.updateMany({
      where: { id: schedule.id, nextRunAt: occurrence },
      data: { nextRunAt: newNextRunAt, lastRunAt: now, lastRunStatus: 'ENQUEUED' },
    });
    if (claim.count !== 1) continue; // another instance already claimed this exact occurrence
    summary.claimedCount += 1;

    // Date-based dedupeKey (not the exact occurrence timestamp): if the
    // scheduler ticks more than once on the same calendar day (restart,
    // multiple instances), every tick after the first is a genuine no-op
    // at the Job layer — deliberately coarser than scheduled-workflow's
    // per-occurrence dedupeKey, matching "at most one backup per day."
    const dedupeKey = `${schedule.id}:${occurrence.toISOString().slice(0, 10)}`;
    const { created } = await enqueueJob({ jobKey: BACKUP_JOB_KEY, dedupeKey, payload: { backupScheduleId: schedule.id } });
    if (created) summary.enqueuedCount += 1;

    console.log(JSON.stringify({
      level: 'info',
      event: 'backup_scheduler.claimed',
      backupScheduleId: schedule.id,
      occurrence: occurrence.toISOString(),
      nextRunAt: newNextRunAt.toISOString(),
      enqueued: created,
      timestamp: new Date().toISOString(),
    }));
  }

  console.log(JSON.stringify({ level: 'info', event: 'backup_scheduler.tick_complete', ...summary, timestamp: new Date().toISOString() }));
  return summary;
}
