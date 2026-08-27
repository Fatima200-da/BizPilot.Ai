import { describe, expect, it } from 'vitest';
import { rate, MIN_SAMPLE_SIZE } from './activation-metrics.service';

/**
 * Phase 29 Section 6: the one thing about activation metrics that must
 * never be fabricated or misleading — a metric computed from too little
 * data must never render as a real-looking percentage. Pure, deterministic,
 * no DB (the real-data queries around this classification are separately
 * exercised in activation-metrics.integration.test.ts, against real
 * Postgres, per this codebase's standard split between fast unit coverage
 * of pure logic and real-execution coverage of the query layer).
 */
describe('activation metrics: rate() classification', () => {
  it('zero denominator is NO_DATA, never a fabricated 0%', () => {
    const result = rate(0, 0);
    expect(result.status).toBe('NO_DATA');
    expect(result.ratePercent).toBeNull();
  });

  it('a denominator below the minimum sample size is INSUFFICIENT_SAMPLE, never a real-looking percentage', () => {
    const result = rate(1, 2);
    expect(result.status).toBe('INSUFFICIENT_SAMPLE');
    expect(result.ratePercent).toBeNull();
    expect(result.numerator).toBe(1);
    expect(result.denominator).toBe(2);
  });

  it('exactly at the minimum sample size is OBSERVED with a real computed percentage', () => {
    const result = rate(3, MIN_SAMPLE_SIZE);
    expect(result.status).toBe('OBSERVED');
    expect(result.ratePercent).toBe(Math.round((3 / MIN_SAMPLE_SIZE) * 1000) / 10);
  });

  it('a real, well-sampled rate computes the correct percentage, rounded to one decimal', () => {
    const result = rate(37, 120);
    expect(result.status).toBe('OBSERVED');
    expect(result.ratePercent).toBeCloseTo((37 / 120) * 100, 1);
  });

  it('100% and 0% (well-sampled) are both reported honestly, never smoothed', () => {
    expect(rate(50, 50).ratePercent).toBe(100);
    expect(rate(0, 50).ratePercent).toBe(0);
  });
});
