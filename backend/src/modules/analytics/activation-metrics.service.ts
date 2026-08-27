import { prisma } from '../../infrastructure/database/prisma';
import { PRODUCT_EVENTS } from './product-event.service';

/**
 * Phase 29 Section 6: activation metrics computed from real data — never
 * fabricated, never hidden behind a misleading 0% when the real answer is
 * "we don't have enough signal yet." `MIN_SAMPLE_SIZE` is a deliberate,
 * documented MVP choice (not a rigorous statistical power calculation) —
 * below it, a metric reports INSUFFICIENT_SAMPLE rather than a real-looking
 * percentage computed from (e.g.) 1 out of 2 workspaces.
 */
export const MIN_SAMPLE_SIZE = 10;

export type MetricStatus = 'OBSERVED' | 'NO_DATA' | 'INSUFFICIENT_SAMPLE';

export interface RateMetric {
  status: MetricStatus;
  /** A percentage 0-100, or null unless status is OBSERVED. */
  ratePercent: number | null;
  numerator: number;
  denominator: number;
}

export interface DurationMetric {
  status: MetricStatus;
  /** Median duration in hours, or null unless status is OBSERVED. */
  medianHours: number | null;
  sampleSize: number;
}

/** Exported for direct unit testing (Phase 29) — the classification logic (OBSERVED/NO_DATA/INSUFFICIENT_SAMPLE) is the part that must never be wrong, and is fully deterministic given (numerator, denominator), unlike the real-data queries around it. */
export function rate(numerator: number, denominator: number): RateMetric {
  if (denominator === 0) return { status: 'NO_DATA', ratePercent: null, numerator, denominator };
  if (denominator < MIN_SAMPLE_SIZE) return { status: 'INSUFFICIENT_SAMPLE', ratePercent: null, numerator, denominator };
  return { status: 'OBSERVED', ratePercent: Math.round((numerator / denominator) * 1000) / 10, numerator, denominator };
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return sorted[mid] ?? 0;
}

export interface ActivationMetricsSnapshot {
  signupConversion: RateMetric;
  onboardingCompletion: RateMetric;
  timeToFirstValue: DurationMetric;
  firstAiActionRate: RateMetric;
  firstWorkflowCompletionRate: RateMetric;
  firstContentApprovalRate: RateMetric;
  sevenDayReturnRate: RateMetric;
}

/** Platform-wide activation metrics — the admin-facing snapshot (Section 7). */
export async function getActivationMetrics(): Promise<ActivationMetricsSnapshot> {
  const [
    signupStarted,
    signupCompleted,
    totalWorkspaces,
    completedOnboardingWorkspaces,
    firstAiActionWorkspaces,
    firstWorkflowStartedWorkspaces,
    firstWorkflowCompletedWorkspaces,
    firstContentGeneratedWorkspaces,
    firstContentApprovedWorkspaces,
  ] = await Promise.all([
    prisma.productEvent.groupBy({ by: ['userId'], where: { eventName: PRODUCT_EVENTS.SIGNUP_STARTED, userId: { not: null } } }),
    prisma.productEvent.groupBy({ by: ['userId'], where: { eventName: PRODUCT_EVENTS.SIGNUP_COMPLETED, userId: { not: null } } }),
    prisma.workspace.count({ where: { deletedAt: null } }),
    prisma.settings.count({ where: { onboardingStatus: 'COMPLETED' } }),
    prisma.productEvent.groupBy({ by: ['workspaceId'], where: { eventName: PRODUCT_EVENTS.FIRST_AI_ACTION, workspaceId: { not: null } } }),
    prisma.productEvent.groupBy({ by: ['workspaceId'], where: { eventName: PRODUCT_EVENTS.FIRST_WORKFLOW_STARTED, workspaceId: { not: null } } }),
    prisma.productEvent.groupBy({ by: ['workspaceId'], where: { eventName: PRODUCT_EVENTS.FIRST_WORKFLOW_COMPLETED, workspaceId: { not: null } } }),
    prisma.productEvent.groupBy({ by: ['workspaceId'], where: { eventName: PRODUCT_EVENTS.FIRST_CONTENT_GENERATED, workspaceId: { not: null } } }),
    prisma.productEvent.groupBy({ by: ['workspaceId'], where: { eventName: PRODUCT_EVENTS.FIRST_CONTENT_APPROVED, workspaceId: { not: null } } }),
  ]);

  // Signup conversion is inherently client-observed for the "started" half
  // (a real limitation of any first-party analytics without server-side
  // funnel tracking of anonymous visitors) — documented here, not hidden.
  const signupConversion = rate(signupCompleted.length, signupStarted.length);
  const onboardingCompletion = rate(completedOnboardingWorkspaces, totalWorkspaces);
  const firstAiActionRate = rate(firstAiActionWorkspaces.length, totalWorkspaces);
  const firstWorkflowCompletionRate = rate(firstWorkflowCompletedWorkspaces.length, firstWorkflowStartedWorkspaces.length);
  const firstContentApprovalRate = rate(firstContentApprovedWorkspaces.length, firstContentGeneratedWorkspaces.length);

  const timeToFirstValue = await computeTimeToFirstValue();
  const sevenDayReturnRate = await computeSevenDayReturnRate();

  return {
    signupConversion,
    onboardingCompletion,
    timeToFirstValue,
    firstAiActionRate,
    firstWorkflowCompletionRate,
    firstContentApprovalRate,
    sevenDayReturnRate,
  };
}

/** Median real hours from workspace creation to that workspace's first approved content asset — the concrete "time to first value" this MVP's own journey (Section 3) defines. */
async function computeTimeToFirstValue(): Promise<DurationMetric> {
  const approvals = await prisma.productEvent.findMany({
    where: { eventName: PRODUCT_EVENTS.FIRST_CONTENT_APPROVED, workspaceId: { not: null } },
    select: { workspaceId: true, createdAt: true },
  });
  if (approvals.length === 0) return { status: 'NO_DATA', medianHours: null, sampleSize: 0 };
  if (approvals.length < MIN_SAMPLE_SIZE) return { status: 'INSUFFICIENT_SAMPLE', medianHours: null, sampleSize: approvals.length };

  const workspaceIds = approvals.map((a) => a.workspaceId).filter((id): id is string => id !== null);
  const workspaces = await prisma.workspace.findMany({ where: { id: { in: workspaceIds } }, select: { id: true, createdAt: true } });
  const createdAtByWorkspace = new Map(workspaces.map((w) => [w.id, w.createdAt]));

  const hoursSamples: number[] = [];
  for (const approval of approvals) {
    if (!approval.workspaceId) continue;
    const createdAt = createdAtByWorkspace.get(approval.workspaceId);
    if (!createdAt) continue;
    const hours = (approval.createdAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
    if (hours >= 0) hoursSamples.push(hours);
  }
  if (hoursSamples.length < MIN_SAMPLE_SIZE) return { status: 'INSUFFICIENT_SAMPLE', medianHours: null, sampleSize: hoursSamples.length };

  hoursSamples.sort((a, b) => a - b);
  return { status: 'OBSERVED', medianHours: Math.round(median(hoursSamples) * 10) / 10, sampleSize: hoursSamples.length };
}

/** Of users who signed up 7+ real days ago, what fraction have a real session_started event more than 7 days after their own signup. */
async function computeSevenDayReturnRate(): Promise<RateMetric> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cohort = await prisma.user.findMany({ where: { createdAt: { lte: sevenDaysAgo }, deletedAt: null }, select: { id: true, createdAt: true } });
  if (cohort.length === 0) return { status: 'NO_DATA', ratePercent: null, numerator: 0, denominator: 0 };
  if (cohort.length < MIN_SAMPLE_SIZE) return { status: 'INSUFFICIENT_SAMPLE', ratePercent: null, numerator: 0, denominator: cohort.length };

  const cohortIds = cohort.map((u) => u.id);
  const sessions = await prisma.productEvent.findMany({
    where: { eventName: PRODUCT_EVENTS.SESSION_STARTED, userId: { in: cohortIds } },
    select: { userId: true, createdAt: true },
  });
  const firstSignupAt = new Map(cohort.map((u) => [u.id, u.createdAt]));
  const returned = new Set<string>();
  for (const session of sessions) {
    if (!session.userId) continue;
    const signupAt = firstSignupAt.get(session.userId);
    if (signupAt && session.createdAt.getTime() >= signupAt.getTime() + 7 * 24 * 60 * 60 * 1000) {
      returned.add(session.userId);
    }
  }
  return rate(returned.size, cohort.length);
}
