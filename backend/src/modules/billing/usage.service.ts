import { prisma } from '../../infrastructure/database/prisma';
import { getAiCreditStatus, getLimit } from './entitlement.service';
import { getCurrentSubscription } from './subscription.service';

/**
 * Phase 25 Section 7/17: usage measured independently from credits, and the
 * customer-facing usage-dashboard aggregation. Every dimension is computed
 * from EXISTING, already-normalized tables (AIUsage, WorkflowInstance,
 * WorkspaceMember, File) via real aggregate queries — deliberately NOT a
 * new redundant "UsageRecord" event-sourcing table, which would duplicate
 * data already correctly modeled elsewhere and introduce a second
 * consistency-maintenance burden this phase has no time to get right under
 * concurrency (the same reasoning Phase 24 applied to `ai_requests_total`
 * vs re-deriving from AIUsage).
 */

export interface UsageMetric {
  used: number;
  limit: number | null;
  remaining: number | null;
}

export interface UsageSummary {
  aiCredits: { balance: number; monthlyAllowance: number };
  aiOperations: { periodTotal: number };
  workflowExecutions: { total: number };
  teamSeats: UsageMetric;
  businessProfiles: UsageMetric;
  activeProjects: UsageMetric;
  storageBytes: number;
}

export async function getUsageSummary(workspaceId: string): Promise<UsageSummary> {
  const subscription = await getCurrentSubscription(workspaceId);

  const [aiCredits, teamSeats, businessProfiles, activeProjects, aiOperationsCount, workflowExecutionsCount, storageAgg] = await Promise.all([
    getAiCreditStatus(workspaceId),
    getLimit(workspaceId, 'teamSeats'),
    getLimit(workspaceId, 'businessProfiles'),
    getLimit(workspaceId, 'activeProjects'),
    prisma.aIUsage.count({ where: { workspaceId, status: 'SUCCEEDED', createdAt: { gte: subscription.currentPeriodStart } } }),
    prisma.workflowInstance.count({ where: { workspaceId } }),
    prisma.file.aggregate({ where: { workspaceId, deletedAt: null }, _sum: { sizeBytes: true } }),
  ]);

  return {
    aiCredits,
    aiOperations: { periodTotal: aiOperationsCount },
    workflowExecutions: { total: workflowExecutionsCount },
    teamSeats,
    businessProfiles,
    activeProjects,
    storageBytes: Number(storageAgg._sum.sizeBytes ?? 0n),
  };
}
