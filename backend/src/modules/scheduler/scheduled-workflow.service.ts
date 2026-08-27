import { DateTime } from 'luxon';
import type { ScheduledWorkflow, ScheduleIntervalUnit, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';

/**
 * Phase 28 Track A Section 2/7: recurring workflow schedules, persisted in
 * real PostgreSQL, with explicit IANA timezone storage and DST-safe
 * next-run computation via `luxon` (which uses Node's built-in ICU/
 * timezone data — never the scheduler process's own machine-local
 * timezone). `nextRunAt` is always stored as a real, precomputed UTC
 * instant so the tick loop (scheduler.service.ts) never has to reason
 * about timezones at claim time — only at schedule-creation/advancement
 * time, where the correctness actually needs to be proven.
 */

const MIN_MINUTE_INTERVAL = 5; // production abuse guardrail — no per-second scheduling
const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface ScheduledWorkflowInput {
  workspaceId: string;
  workflowDefinitionKey: string;
  businessProfileId?: string;
  createdByUserId?: string;
  name: string;
  intervalUnit: ScheduleIntervalUnit;
  intervalValue?: number;
  timeOfDay?: string;
  dayOfWeek?: number;
  timezone?: string;
  input?: Record<string, unknown>;
}

function isValidTimezone(tz: string): boolean {
  try {
    // the constructor throws RangeError on an invalid IANA name; that's the whole check
    void new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseTimeOfDay(value: string): { hour: number; minute: number } {
  const match = TIME_OF_DAY_PATTERN.exec(value);
  if (!match) throw new ValidationError([{ field: 'timeOfDay', code: 'INVALID_FORMAT', message: 'timeOfDay must be in "HH:mm" 24-hour format.' }]);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** Server-side validation (Phase 28 Track A Section 2: "Validate schedule input server-side") — never trust the client's own arithmetic. */
export function validateScheduleInput(input: ScheduledWorkflowInput): void {
  const errors: Array<{ field: string; code: string; message: string }> = [];

  if (!input.name || input.name.trim().length === 0) {
    errors.push({ field: 'name', code: 'REQUIRED', message: 'name is required.' });
  }

  const intervalValue = input.intervalValue ?? 1;
  if (!Number.isInteger(intervalValue) || intervalValue < 1) {
    errors.push({ field: 'intervalValue', code: 'INVALID', message: 'intervalValue must be a positive integer.' });
  }
  if (input.intervalUnit === 'MINUTE' && intervalValue < MIN_MINUTE_INTERVAL) {
    errors.push({ field: 'intervalValue', code: 'TOO_FREQUENT', message: `Minute-granularity schedules must be at least ${String(MIN_MINUTE_INTERVAL)} minutes apart.` });
  }

  const timezone = input.timezone ?? 'UTC';
  if (!isValidTimezone(timezone)) {
    errors.push({ field: 'timezone', code: 'INVALID_TIMEZONE', message: `"${timezone}" is not a recognized IANA timezone name.` });
  }

  if (['DAY', 'WEEK', 'MONTH'].includes(input.intervalUnit)) {
    if (!input.timeOfDay) {
      errors.push({ field: 'timeOfDay', code: 'REQUIRED', message: 'timeOfDay is required for DAY/WEEK/MONTH schedules.' });
    } else if (!TIME_OF_DAY_PATTERN.test(input.timeOfDay)) {
      errors.push({ field: 'timeOfDay', code: 'INVALID_FORMAT', message: 'timeOfDay must be in "HH:mm" 24-hour format.' });
    }
  }

  if (input.intervalUnit === 'WEEK') {
    if (input.dayOfWeek === undefined) {
      errors.push({ field: 'dayOfWeek', code: 'REQUIRED', message: 'dayOfWeek is required for WEEK schedules.' });
    } else if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      errors.push({ field: 'dayOfWeek', code: 'INVALID', message: 'dayOfWeek must be an integer from 0 (Sunday) to 6 (Saturday).' });
    }
  }

  if (errors.length > 0) throw new ValidationError(errors);
}

/**
 * DST-safe: always resolves wall-clock components (hour/minute, day-of-week)
 * against the schedule's real IANA timezone via luxon, which consults
 * Node's ICU tzdata for the SPECIFIC target date — so a schedule that
 * crosses a DST transition automatically fires at the correct UTC instant
 * on both sides of the transition, never off by the DST delta.
 */
export function computeNextRunAt(
  schedule: { intervalUnit: ScheduleIntervalUnit; intervalValue: number; timeOfDay: string | null; dayOfWeek: number | null; timezone: string },
  after: Date
): Date {
  const afterZoned = DateTime.fromJSDate(after, { zone: schedule.timezone });

  switch (schedule.intervalUnit) {
    case 'MINUTE':
      return afterZoned.plus({ minutes: schedule.intervalValue }).toUTC().toJSDate();
    case 'HOUR':
      return afterZoned.plus({ hours: schedule.intervalValue }).toUTC().toJSDate();
    case 'DAY': {
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay ?? '00:00');
      let candidate = afterZoned.set({ hour, minute, second: 0, millisecond: 0 });
      if (candidate <= afterZoned) candidate = candidate.plus({ days: schedule.intervalValue });
      return candidate.toUTC().toJSDate();
    }
    case 'WEEK': {
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay ?? '00:00');
      const targetLuxonWeekday = schedule.dayOfWeek === 0 ? 7 : (schedule.dayOfWeek ?? 1); // luxon: 1=Monday..7=Sunday
      let candidate = afterZoned.set({ hour, minute, second: 0, millisecond: 0 });
      // Advance one day at a time to the next real occurrence of the target
      // weekday strictly after `after` — correct across month/year boundaries.
      while (candidate.weekday !== targetLuxonWeekday || candidate <= afterZoned) {
        candidate = candidate.plus({ days: 1 });
      }
      if (schedule.intervalValue > 1) candidate = candidate.plus({ weeks: schedule.intervalValue - 1 });
      return candidate.toUTC().toJSDate();
    }
    case 'MONTH': {
      const { hour, minute } = parseTimeOfDay(schedule.timeOfDay ?? '00:00');
      let candidate = afterZoned.set({ hour, minute, second: 0, millisecond: 0 });
      if (candidate <= afterZoned) candidate = candidate.plus({ months: schedule.intervalValue });
      return candidate.toUTC().toJSDate();
    }
    default:
      throw new ValidationError([{ field: 'intervalUnit', code: 'INVALID', message: `Unknown interval unit.` }]);
  }
}

export async function createScheduledWorkflow(input: ScheduledWorkflowInput): Promise<ScheduledWorkflow> {
  validateScheduleInput(input);

  const definition = await prisma.workflowDefinition.findFirst({
    where: { workspaceId: null, key: input.workflowDefinitionKey, status: 'ACTIVE', deletedAt: null },
  });
  if (!definition) {
    throw new ValidationError([{ field: 'workflowDefinitionKey', code: 'NOT_FOUND', message: `No active workflow definition "${input.workflowDefinitionKey}".` }]);
  }

  if (input.businessProfileId) {
    const profile = await prisma.businessProfile.findFirst({ where: { id: input.businessProfileId, workspaceId: input.workspaceId } });
    if (!profile) throw new ValidationError([{ field: 'businessProfileId', code: 'NOT_FOUND', message: 'businessProfileId does not belong to this workspace.' }]);
  }

  const intervalValue = input.intervalValue ?? 1;
  const timezone = input.timezone ?? 'UTC';
  const nextRunAt = computeNextRunAt(
    { intervalUnit: input.intervalUnit, intervalValue, timeOfDay: input.timeOfDay ?? null, dayOfWeek: input.dayOfWeek ?? null, timezone },
    new Date()
  );

  return prisma.scheduledWorkflow.create({
    data: {
      workspaceId: input.workspaceId,
      workflowDefinitionKey: input.workflowDefinitionKey,
      businessProfileId: input.businessProfileId,
      createdByUserId: input.createdByUserId,
      name: input.name,
      intervalUnit: input.intervalUnit,
      intervalValue,
      timeOfDay: input.timeOfDay,
      dayOfWeek: input.dayOfWeek,
      timezone,
      input: input.input as Prisma.InputJsonValue,
      nextRunAt,
    },
  });
}

export async function listScheduledWorkflows(workspaceId: string): Promise<ScheduledWorkflow[]> {
  return prisma.scheduledWorkflow.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export async function setScheduledWorkflowEnabled(workspaceId: string, id: string, enabled: boolean): Promise<ScheduledWorkflow> {
  const existing = await prisma.scheduledWorkflow.findFirst({ where: { id, workspaceId } });
  if (!existing) throw new NotFoundError('Scheduled workflow not found.');

  // Re-anchor nextRunAt to "now" when re-enabling a long-disabled schedule
  // so it doesn't immediately fire a backlog of missed occurrences the
  // instant it's turned back on — see missed-job recovery (scheduler.service.ts)
  // for the intentional, bounded exception to this (a schedule missed
  // during real downtime, not an operator-disabled one).
  const nextRunAt = enabled
    ? computeNextRunAt(
        { intervalUnit: existing.intervalUnit, intervalValue: existing.intervalValue, timeOfDay: existing.timeOfDay, dayOfWeek: existing.dayOfWeek, timezone: existing.timezone },
        new Date()
      )
    : existing.nextRunAt;

  return prisma.scheduledWorkflow.update({ where: { id }, data: { enabled, nextRunAt } });
}
