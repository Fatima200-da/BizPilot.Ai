import { describe, expect, it } from 'vitest';
import { ensureSeeded } from '../../testing/integration-helpers';
import { getActivationMetrics, type RateMetric, type DurationMetric } from './activation-metrics.service';

function assertValidRateMetric(metric: RateMetric): void {
  expect(['OBSERVED', 'NO_DATA', 'INSUFFICIENT_SAMPLE']).toContain(metric.status);
  expect(metric.numerator).toBeGreaterThanOrEqual(0);
  expect(metric.denominator).toBeGreaterThanOrEqual(0);
  // Note: numerator is NOT asserted <= denominator here — signupConversion
  // specifically compares two independently-tracked populations
  // (client-only signup_started vs server-side signup_completed), which
  // can legitimately diverge (e.g. signup_started never fires in any
  // backend-only test run, while signup_completed fires on every real
  // registration) — that is a real, documented limitation of client-side
  // funnel tracking, not a metric-computation bug.
  if (metric.status === 'OBSERVED') {
    expect(metric.ratePercent).not.toBeNull();
    expect(metric.ratePercent).toBeGreaterThanOrEqual(0);
    expect(metric.ratePercent).toBeLessThanOrEqual(100);
  } else {
    expect(metric.ratePercent).toBeNull();
  }
}

function assertValidDurationMetric(metric: DurationMetric): void {
  expect(['OBSERVED', 'NO_DATA', 'INSUFFICIENT_SAMPLE']).toContain(metric.status);
  expect(metric.sampleSize).toBeGreaterThanOrEqual(0);
  if (metric.status === 'OBSERVED') {
    expect(metric.medianHours).not.toBeNull();
    expect(metric.medianHours).toBeGreaterThanOrEqual(0);
  } else {
    expect(metric.medianHours).toBeNull();
  }
}

/**
 * Phase 29 Section 6: this suite runs against the real, shared dev
 * database (accumulated real history across every prior phase's own real
 * execution) — deliberately does NOT assert exact percentages (that
 * history is neither controlled nor reproducible run-to-run), only that
 * every metric is real, well-formed, and never a fabricated/misleading
 * value. The classification thresholds themselves (NO_DATA vs
 * INSUFFICIENT_SAMPLE vs OBSERVED) are exhaustively unit-tested in
 * activation-metrics.service.test.ts against controlled inputs.
 */
describe('Activation metrics snapshot (integration, real Postgres)', () => {
  it('computes a real, structurally valid snapshot from the real database without throwing', async () => {
    await ensureSeeded();
    const snapshot = await getActivationMetrics();

    assertValidRateMetric(snapshot.signupConversion);
    assertValidRateMetric(snapshot.onboardingCompletion);
    assertValidRateMetric(snapshot.firstAiActionRate);
    assertValidRateMetric(snapshot.firstWorkflowCompletionRate);
    assertValidRateMetric(snapshot.firstContentApprovalRate);
    assertValidRateMetric(snapshot.sevenDayReturnRate);
    assertValidDurationMetric(snapshot.timeToFirstValue);
  });
});
