import { prisma } from '../../infrastructure/database/prisma';
import { getBalance } from './credit-ledger.service';
import { getCurrentSubscription, type SubscriptionWithPlan } from './subscription.service';
import { PlanLimitReachedError } from '../../common/errors/app-error';
import type { PlanFeatureMatrix } from '../../scripts/seed-subscription-plans';

/**
 * Phase 25 Section 3: the ONE authoritative server-side entitlement layer.
 * Every protected feature/limit check in this codebase must go through
 * this module — never re-implement a plan check inline in a controller.
 * Frontend checks (Section 28) are UX only; this is what actually enforces.
 */

export type LimitedFeature = 'teamSeats' | 'workspaces' | 'businessProfiles' | 'activeProjects';
export type BooleanFeature = keyof PlanFeatureMatrix;

interface LimitStatus {
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null; // null = unlimited
}

async function countUsage(workspaceId: string, feature: LimitedFeature): Promise<number> {
  switch (feature) {
    case 'teamSeats':
      return prisma.workspaceMember.count({ where: { workspaceId, status: 'ACTIVE', deletedAt: null } });
    case 'businessProfiles':
      return prisma.businessProfile.count({ where: { workspaceId, deletedAt: null } });
    case 'activeProjects':
      return prisma.project.count({ where: { workspaceId, status: 'ACTIVE' } });
    case 'workspaces': {
      const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
      return prisma.workspace.count({ where: { ownerUserId: ws.ownerUserId, deletedAt: null } });
    }
    default:
      return 0;
  }
}

function planLimitFor(plan: SubscriptionWithPlan['plan'], feature: LimitedFeature): number | null {
  switch (feature) {
    case 'teamSeats':
      return plan.maxTeamSeats;
    case 'workspaces':
      return plan.maxWorkspaces;
    case 'businessProfiles':
      return plan.maxBusinessProfiles;
    case 'activeProjects':
      return plan.maxActiveProjects;
    default:
      return null;
  }
}

export async function getLimit(workspaceId: string, feature: LimitedFeature): Promise<LimitStatus> {
  const subscription = await getCurrentSubscription(workspaceId);
  const limit = planLimitFor(subscription.plan, feature);
  const used = await countUsage(workspaceId, feature);
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}

export async function getUsage(workspaceId: string, feature: LimitedFeature): Promise<number> {
  return countUsage(workspaceId, feature);
}

export async function getRemaining(workspaceId: string, feature: LimitedFeature): Promise<number | null> {
  const status = await getLimit(workspaceId, feature);
  return status.remaining;
}

/** Section 8: AI credits are their own dimension (Phase 24's ledger), exposed here so the entitlement layer is the single place callers check "can I afford this". */
export async function getAiCreditStatus(workspaceId: string): Promise<{ balance: number; monthlyAllowance: number }> {
  const [balance, subscription] = await Promise.all([getBalance(workspaceId), getCurrentSubscription(workspaceId)]);
  return { balance, monthlyAllowance: subscription.plan.aiCreditsPerMonth };
}

export async function canUseFeature(workspaceId: string, feature: BooleanFeature): Promise<boolean> {
  const subscription = await getCurrentSubscription(workspaceId);
  const matrix = subscription.plan.featureMatrix as unknown as PlanFeatureMatrix;
  return matrix[feature];
}

/** Throws PlanLimitReachedError if the boolean feature is not enabled on the current plan. Server-side gate — the only one that matters (Section 3). */
export async function assertFeatureEntitled(workspaceId: string, feature: BooleanFeature): Promise<void> {
  const enabled = await canUseFeature(workspaceId, feature);
  if (!enabled) {
    throw new PlanLimitReachedError(`This feature ("${feature}") is not included in the current plan.`);
  }
}

/**
 * Throws PlanLimitReachedError if creating one more of `feature` would
 * exceed the current plan's limit. Callers pass this BEFORE creating the
 * resource (e.g. before inserting a new WorkspaceMember), mirroring Phase
 * 24's "check before, never after" billing-integrity pattern.
 */
export async function assertEntitled(workspaceId: string, feature: LimitedFeature): Promise<void> {
  const status = await getLimit(workspaceId, feature);
  if (status.limit !== null && status.used >= status.limit) {
    throw new PlanLimitReachedError(`This workspace has reached its plan limit of ${String(status.limit)} for ${feature} (currently using ${String(status.used)}). Upgrade the plan to add more.`);
  }
}
