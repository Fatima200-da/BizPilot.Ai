/**
 * Phase 29 Section 13 / Phase 34 Track D: the real credit lifecycle —
 * Healthy -> Low -> Critical -> Exhausted — with thresholds that EXACTLY
 * match the backend's real `usage-alert.service.ts` (`THRESHOLDS = [80, 90,
 * 100]` percent used), which is what actually fires the
 * CREDITS_LOW/CREDITS_EXHAUSTED notifications. Extracted from BillingPage
 * (Phase 34) so the Dashboard's "needs attention" card computes the
 * identical status from the identical real data — the previous
 * single-consumer version already fixed a real inconsistency defect where
 * a second, independent copy of this logic used different thresholds; this
 * extraction prevents that class of defect from recurring as a second
 * consumer gets added.
 */
export type CreditLifecycleState = 'HEALTHY' | 'LOW' | 'CRITICAL' | 'EXHAUSTED';

export function getCreditLifecycleState(balance: number, monthlyAllowance: number): CreditLifecycleState {
  const usedPercent = monthlyAllowance > 0 ? ((monthlyAllowance - balance) / monthlyAllowance) * 100 : 0;
  if (balance <= 0 || usedPercent >= 100) return 'EXHAUSTED';
  if (usedPercent >= 90) return 'CRITICAL';
  if (usedPercent >= 80) return 'LOW';
  return 'HEALTHY';
}

export const CREDIT_LIFECYCLE_COPY: Record<CreditLifecycleState, { label: string; barClass: string }> = {
  HEALTHY: { label: 'Healthy', barClass: 'bg-primary' },
  LOW: { label: 'Running low', barClass: 'bg-warning' },
  CRITICAL: { label: 'Critical — almost exhausted', barClass: 'bg-danger' },
  EXHAUSTED: { label: 'Exhausted', barClass: 'bg-danger' },
};
