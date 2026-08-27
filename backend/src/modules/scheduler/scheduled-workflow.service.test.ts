import { describe, expect, it } from 'vitest';
import { computeNextRunAt, validateScheduleInput } from './scheduled-workflow.service';
import { ValidationError } from '../../common/errors/app-error';

/**
 * Phase 28 Track A Section 7: timezone/DST correctness for schedule
 * arithmetic — pure unit tests (no database needed), but real execution
 * against `luxon`'s real ICU-backed timezone data, not a hand-rolled or
 * mocked offset table. Every assertion below is a real UTC instant
 * computed from a real IANA timezone name.
 */
describe('computeNextRunAt (real timezone/DST arithmetic)', () => {
  it('MINUTE schedule advances by exactly intervalValue minutes in UTC, regardless of timezone', () => {
    const after = new Date('2026-03-01T10:00:00.000Z');
    const next = computeNextRunAt({ intervalUnit: 'MINUTE', intervalValue: 15, timeOfDay: null, dayOfWeek: null, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-03-01T10:15:00.000Z');
  });

  it('HOUR schedule advances by exactly intervalValue hours', () => {
    const after = new Date('2026-03-01T10:00:00.000Z');
    const next = computeNextRunAt({ intervalUnit: 'HOUR', intervalValue: 6, timeOfDay: null, dayOfWeek: null, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-03-01T16:00:00.000Z');
  });

  it('DAY schedule in UTC fires at the exact configured time the next day when already past today\'s time', () => {
    const after = new Date('2026-03-01T15:00:00.000Z'); // 15:00 UTC — already past 09:00
    const next = computeNextRunAt({ intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-03-02T09:00:00.000Z');
  });

  it('DAY schedule in a non-UTC timezone (America/New_York, EST, winter) computes the correct UTC instant', () => {
    // 9am EST (UTC-5) on Jan 15 = 14:00 UTC.
    const after = new Date('2026-01-14T20:00:00.000Z');
    const next = computeNextRunAt({ intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'America/New_York' }, after);
    expect(next.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });

  it('DAY schedule in a non-UTC timezone (Asia/Tokyo, UTC+9, no DST) computes the correct UTC instant', () => {
    // 9am JST (UTC+9) on Jan 15 = 00:00 UTC same day.
    const after = new Date('2026-01-14T10:00:00.000Z');
    const next = computeNextRunAt({ intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'Asia/Tokyo' }, after);
    expect(next.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('DST transition: the SAME schedule (9am America/New_York) resolves to a different UTC offset before vs after the spring-forward transition', () => {
    // 2026-03-08 is the real US DST transition date (2am -> 3am). Confirm
    // the schedule correctly uses EST (UTC-5) before and EDT (UTC-4) after
    // — never a fixed, incorrect offset carried across the transition.
    const beforeDst = computeNextRunAt({ intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'America/New_York' }, new Date('2026-03-01T00:00:00.000Z'));
    const afterDst = computeNextRunAt({ intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'America/New_York' }, new Date('2026-03-20T00:00:00.000Z'));
    expect(beforeDst.toISOString()).toBe('2026-03-01T14:00:00.000Z'); // EST: UTC-5
    expect(afterDst.toISOString()).toBe('2026-03-20T13:00:00.000Z'); // EDT: UTC-4 — a naive fixed-offset implementation would get this wrong
  });

  it('WEEK schedule advances to the correct next occurrence of dayOfWeek, real weekday arithmetic', () => {
    // 2026-03-01 is a Sunday. Schedule for Wednesday (dayOfWeek=3) 09:00 UTC.
    const after = new Date('2026-03-01T00:00:00.000Z');
    const next = computeNextRunAt({ intervalUnit: 'WEEK', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: 3, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-03-04T09:00:00.000Z'); // the following Wednesday
  });

  it('WEEK schedule with intervalValue=2 skips an extra week past the immediate next occurrence', () => {
    const after = new Date('2026-03-01T00:00:00.000Z'); // Sunday
    const next = computeNextRunAt({ intervalUnit: 'WEEK', intervalValue: 2, timeOfDay: '09:00', dayOfWeek: 3, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-03-11T09:00:00.000Z'); // Wed Mar 4 + 1 extra week
  });

  it('MONTH schedule advances by exactly intervalValue months once the configured time has already passed for the current month', () => {
    const after = new Date('2026-01-20T15:00:00.000Z'); // already past 09:00 on the 20th
    const next = computeNextRunAt({ intervalUnit: 'MONTH', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-02-20T09:00:00.000Z');
  });

  it('MONTH schedule fires later the same day if the configured time has not yet passed', () => {
    const after = new Date('2026-01-20T00:00:00.000Z'); // before 09:00 on the 20th
    const next = computeNextRunAt({ intervalUnit: 'MONTH', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: null, timezone: 'UTC' }, after);
    expect(next.toISOString()).toBe('2026-01-20T09:00:00.000Z');
  });
});

describe('validateScheduleInput (server-side validation — never trust client arithmetic)', () => {
  const base = { workspaceId: 'ws1', workflowDefinitionKey: 'marketing-autopilot', name: 'Test schedule' };

  it('rejects a missing name', () => {
    expect(() => { validateScheduleInput({ ...base, name: '', intervalUnit: 'HOUR', intervalValue: 1 }); }).toThrow(ValidationError);
  });

  it('rejects a non-positive intervalValue', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'HOUR', intervalValue: 0 }); }).toThrow(ValidationError);
  });

  it('rejects a MINUTE schedule more frequent than the abuse-guardrail floor', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'MINUTE', intervalValue: 1 }); }).toThrow(ValidationError);
  });

  it('accepts a MINUTE schedule at exactly the floor', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'MINUTE', intervalValue: 5 }); }).not.toThrow();
  });

  it('rejects an invalid IANA timezone name', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'HOUR', intervalValue: 1, timezone: 'Not/A_Real_Zone' }); }).toThrow(ValidationError);
  });

  it('accepts a real IANA timezone name', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', timezone: 'Europe/Berlin' }); }).not.toThrow();
  });

  it('rejects a DAY schedule missing timeOfDay', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'DAY', intervalValue: 1 }); }).toThrow(ValidationError);
  });

  it('rejects a malformed timeOfDay', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '25:99' }); }).toThrow(ValidationError);
  });

  it('rejects a WEEK schedule missing dayOfWeek', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'WEEK', intervalValue: 1, timeOfDay: '09:00' }); }).toThrow(ValidationError);
  });

  it('rejects an out-of-range dayOfWeek', () => {
    expect(() => { validateScheduleInput({ ...base, intervalUnit: 'WEEK', intervalValue: 1, timeOfDay: '09:00', dayOfWeek: 7 }); }).toThrow(ValidationError);
  });
});
