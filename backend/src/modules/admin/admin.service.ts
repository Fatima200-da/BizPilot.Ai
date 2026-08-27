import type { Job } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import { getCurrentSubscription } from '../billing/subscription.service';
import { getUsageSummary } from '../billing/usage.service';
import { listMembers } from '../team/member.service';
import { grantCredits } from '../billing/credit-ledger.service';
import { getActivationMetrics, type ActivationMetricsSnapshot } from '../analytics/activation-metrics.service';
import { PRODUCT_EVENTS } from '../analytics/product-event.service';

/**
 * Phase 26 Section 6: internal administration layer. Every function here
 * is only reachable behind `requireSystemAdmin` (auth.ts) — never gated by
 * a workspace-level role. Read operations intentionally reuse the exact
 * same service functions customer-facing routes use (entitlement.service,
 * usage.service, member.service) rather than a parallel admin-only query
 * path, so admin inspection can never drift from what the customer sees.
 */

/**
 * Phase 27 Section 11: platform-wide dashboard metrics — every number here
 * is a real, live aggregate query against the current database, never a
 * cached/precomputed snapshot. `systemHealth` is a real round-trip query
 * against the same connection pool every other request uses, not a static
 * "ok" flag.
 */
export interface AdminDashboardMetrics {
  totalUsers: number;
  newUsers30d: number;
  activeUsers30d: number;
  suspendedUsers: number;
  totalWorkspaces: number;
  activeWorkspaces30d: number;
  subscriptionsByStatus: Record<string, number>;
  aiOperationsTotal: number;
  aiOperationsFailedTotal: number;
  aiAverageLatencyMs: number | null;
  creditsConsumedTotal: number;
  workflowExecutionsTotal: number;
  workflowsFailedTotal: number;
  workflowsByStatus: Record<string, number>;
  jobsByStatus: Record<string, number>;
  jobsDeadLetteredTotal: number;
  /**
   * Real sum of `priceMonthlyCents` across every subscription whose status
   * is ACTIVE or TRIALING, from the real plan catalog this platform's own
   * entitlement checks use — never labeled "MRR": this environment has no
   * real Stripe billing connected (Phase 28's REAL_PAYMENT_PROVIDER remains
   * BLOCKED — CREDENTIAL), so this is what the platform WOULD be collecting
   * at real catalog price if every active subscription were a real paying
   * customer, not confirmed collected revenue.
   */
  activeSubscriptionCatalogValueCents: number;
  upgradesTotal30d: number;
  cancellationsTotal30d: number;
  paymentFailuresTotal30d: number;
  activation: ActivationMetricsSnapshot;
  systemHealth: 'healthy' | 'degraded';
}

export async function getDashboardMetrics(): Promise<AdminDashboardMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    newUsers30d,
    activeUsers30d,
    suspendedUsers,
    totalWorkspaces,
    activeWorkspaceWorkflowIds,
    activeWorkspaceAiIds,
    subscriptionGroups,
    aiOperationsTotal,
    aiOperationsFailedTotal,
    aiLatencyAgg,
    creditsConsumedAgg,
    workflowExecutionsTotal,
    workflowsFailedTotal,
    workflowGroups,
    jobGroups,
    activeSubscriptionPlans,
    upgradesTotal30d,
    cancellationsTotal30d,
    paymentFailuresTotal30d,
    activation,
    dbHealthy,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.user.count({ where: { deletedAt: null, lastLoginAt: { gte: thirtyDaysAgo } } }),
    prisma.user.count({ where: { deletedAt: { not: null } } }), // this codebase has no separate "suspended" flag — soft-deleted accounts are the real, honest proxy, not a fabricated status
    prisma.workspace.count({ where: { deletedAt: null } }),
    prisma.workflowInstance.groupBy({ by: ['workspaceId'], where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.aIUsage.groupBy({ by: ['workspaceId'], where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.aIUsage.count(),
    prisma.aIUsage.count({ where: { status: 'BLOCKED_BY_CREDIT_LIMIT' } }), // the only real failure-shaped AIUsage status this schema has — provider-level errors never reach this table (Phase 24: recordUsage is only called AFTER a successful provider response)
    prisma.aIUsage.aggregate({ _avg: { latencyMs: true }, where: { latencyMs: { not: null } } }),
    prisma.aIUsage.aggregate({ _sum: { creditsConsumed: true } }),
    prisma.workflowInstance.count(),
    prisma.workflowInstance.count({ where: { status: 'FAILED' } }),
    prisma.workflowInstance.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.job.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.subscription.findMany({ where: { status: { in: ['ACTIVE', 'TRIALING'] } }, select: { plan: { select: { priceMonthlyCents: true } } } }),
    prisma.productEvent.count({ where: { eventName: PRODUCT_EVENTS.UPGRADE_COMPLETED, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.productEvent.count({ where: { eventName: PRODUCT_EVENTS.SUBSCRIPTION_CANCELED, createdAt: { gte: thirtyDaysAgo } } }),
    prisma.notification.count({ where: { type: 'PAYMENT_FAILED', createdAt: { gte: thirtyDaysAgo } } }),
    getActivationMetrics(),
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
  ]);

  const subscriptionsByStatus: Record<string, number> = {};
  for (const group of subscriptionGroups) subscriptionsByStatus[group.status] = group._count._all;

  const workflowsByStatus: Record<string, number> = {};
  for (const group of workflowGroups) workflowsByStatus[group.status] = group._count._all;

  const jobsByStatus: Record<string, number> = {};
  for (const group of jobGroups) jobsByStatus[group.status] = group._count._all;

  const activeWorkspaces30d = new Set([...activeWorkspaceWorkflowIds.map((g) => g.workspaceId), ...activeWorkspaceAiIds.map((g) => g.workspaceId)]).size;
  const activeSubscriptionCatalogValueCents = activeSubscriptionPlans.reduce((sum, s) => sum + (s.plan.priceMonthlyCents ?? 0), 0);

  return {
    totalUsers,
    newUsers30d,
    activeUsers30d,
    suspendedUsers,
    totalWorkspaces,
    activeWorkspaces30d,
    subscriptionsByStatus,
    aiOperationsTotal,
    aiOperationsFailedTotal,
    aiAverageLatencyMs: aiLatencyAgg._avg.latencyMs !== null ? Math.round(aiLatencyAgg._avg.latencyMs) : null,
    creditsConsumedTotal: creditsConsumedAgg._sum.creditsConsumed ?? 0,
    workflowExecutionsTotal,
    workflowsFailedTotal,
    workflowsByStatus,
    jobsByStatus,
    jobsDeadLetteredTotal: jobsByStatus.FAILED ?? 0,
    activeSubscriptionCatalogValueCents,
    upgradesTotal30d,
    cancellationsTotal30d,
    paymentFailuresTotal30d,
    activation,
    systemHealth: dbHealthy ? 'healthy' : 'degraded',
  };
}

export interface UserSearchResult {
  id: string;
  email: string;
  fullName: string;
  isSystemAdmin: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
  workspaces: Array<{ id: string; name: string; role: string; subscriptionStatus: string | null }>;
}

/** Phase 27 Section 11: user search/filter/view — real membership + subscription data per user, not a placeholder list. */
export async function searchUsers(query: string, limit = 20): Promise<UserSearchResult[]> {
  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      OR: query ? [{ email: { contains: query, mode: 'insensitive' } }, { fullName: { contains: query, mode: 'insensitive' } }] : undefined,
    },
    include: {
      workspaceMemberships: {
        where: { status: 'ACTIVE', deletedAt: null },
        include: { workspace: { include: { subscriptions: { where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'] } }, take: 1 } } }, role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });

  return users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    isSystemAdmin: u.isSystemAdmin,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    workspaces: u.workspaceMemberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role.key,
      subscriptionStatus: m.workspace.subscriptions[0]?.status ?? null,
    })),
  }));
}

export interface WorkspaceSearchResult {
  id: string;
  name: string;
  slug: string;
  ownerEmail: string;
  createdAt: Date;
  isActive: boolean;
}

export async function searchWorkspaces(query: string, limit = 20): Promise<WorkspaceSearchResult[]> {
  const workspaces = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      OR: query ? [{ name: { contains: query, mode: 'insensitive' } }, { slug: { contains: query, mode: 'insensitive' } }] : undefined,
    },
    include: { owner: { select: { email: true } } },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
  });
  return workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, ownerEmail: w.owner.email, createdAt: w.createdAt, isActive: w.isActive }));
}

export interface WorkspaceInspection {
  workspace: { id: string; name: string; slug: string; ownerEmail: string; createdAt: Date; isActive: boolean };
  subscription: Awaited<ReturnType<typeof getCurrentSubscription>>;
  usage: Awaited<ReturnType<typeof getUsageSummary>>;
  members: Awaited<ReturnType<typeof listMembers>>;
}

export async function inspectWorkspace(workspaceId: string): Promise<WorkspaceInspection> {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null }, include: { owner: { select: { email: true } } } });
  if (!workspace) throw new NotFoundError('Workspace not found.');

  const [subscription, usage, members] = await Promise.all([getCurrentSubscription(workspaceId), getUsageSummary(workspaceId), listMembers(workspaceId)]);

  return {
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, ownerEmail: workspace.owner.email, createdAt: workspace.createdAt, isActive: workspace.isActive },
    subscription,
    usage,
    members,
  };
}

export async function getWorkspaceAuditLog(workspaceId: string, limit = 50): Promise<Array<{ id: string; action: string; entityType: string; entityId: string; actorUserId: string | null; createdAt: Date }>> {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
  if (!workspace) throw new NotFoundError('Workspace not found.');

  const rows = await prisma.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });
  return rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, actorUserId: r.actorUserId, createdAt: r.createdAt }));
}

/**
 * Real, mutating admin action — the one this phase implements end to end
 * to prove Section 6's "admin actions themselves must create AuditLog
 * records" requirement, not just describe it. Reuses the existing,
 * already-tested `grantCredits` (Phase 24/25) rather than writing directly
 * to `AICredit`.
 */
export async function adjustWorkspaceCredits(
  workspaceId: string,
  adminUserId: string,
  amount: number,
  note: string
): Promise<{ balanceAfter: number }> {
  if (amount === 0) {
    throw new ValidationError([{ field: 'amount', code: 'INVALID', message: 'Adjustment amount must be non-zero.' }]);
  }
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
  if (!workspace) throw new NotFoundError('Workspace not found.');

  const result = await grantCredits({ workspaceId, amount, type: 'MANUAL_ADJUSTMENT', note: `[Admin] ${note}`, createdByUserId: adminUserId });

  await prisma.auditLog.create({
    data: {
      workspaceId,
      actorUserId: adminUserId,
      action: 'BILLING_CHANGE',
      entityType: 'AdminAction',
      entityId: workspaceId,
      newValue: { action: 'credit_adjustment', amount, note, balanceAfter: result.balanceAfter },
    },
  });

  return result;
}

/**
 * Phase 29 Section 9: dead-letter job operations. `Job` is deliberately
 * platform-level infrastructure with no workspace FK (Phase 27 design,
 * unchanged) — `AuditLog` is workspace-scoped by design (a real compliance
 * record for tenant-facing actions) and is the wrong model for this, so
 * these actions are logged the same way every other platform-level
 * scheduler/queue event already is (structured JSON via console.log —
 * scheduler-tick.service.ts's own established pattern), not silently
 * unaudited.
 */
export interface DeadLetterJobSummary {
  id: string;
  jobKey: string;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

function toDeadLetterSummary(job: Job): DeadLetterJobSummary {
  return {
    id: job.id,
    jobKey: job.jobKey,
    dedupeKey: job.dedupeKey,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export async function listDeadLetterJobs(limit = 50): Promise<DeadLetterJobSummary[]> {
  const jobs = await prisma.job.findMany({
    where: { status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(limit, 200),
  });
  return jobs.map(toDeadLetterSummary);
}

function logAdminJobAction(event: string, jobId: string, adminUserId: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, jobId, adminUserId, ...extra, timestamp: new Date().toISOString() }));
}

/**
 * Retries a dead-lettered job by resetting it to PENDING — the SAME
 * worker/lease/claim machinery (job-queue.service.ts) then picks it up
 * exactly as it would any other due job, reusing every existing
 * exactly-once guarantee (the job's own dedupeKey uniqueness, and — for
 * the scheduled-workflow lane specifically — startWorkflow's own
 * idempotencyKey) rather than inventing new dedup logic here. The reset
 * itself is a real atomic conditional `updateMany` keyed on the job still
 * being FAILED, so a second concurrent/duplicate retry call for the same
 * job is a genuine no-op (returns a real error, never silently "succeeds"
 * twice) — satisfying "retry must not duplicate business effects" at the
 * database level, not just by convention.
 */
export async function retryDeadLetterJob(jobId: string, adminUserId: string): Promise<DeadLetterJobSummary> {
  const claim = await prisma.job.updateMany({
    where: { id: jobId, status: 'FAILED' },
    data: { status: 'PENDING', attempts: 0, lastError: null, nextRunAt: new Date(), leaseOwner: null, leaseExpiresAt: null },
  });
  if (claim.count !== 1) {
    const existing = await prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) throw new NotFoundError('Job not found.');
    throw new ValidationError([{ field: 'status', code: 'INVALID_TRANSITION', message: `Job is not dead-lettered (current status: ${existing.status}) and cannot be retried.` }]);
  }
  logAdminJobAction('admin.job_retried', jobId, adminUserId);
  return toDeadLetterSummary(await prisma.job.findUniqueOrThrow({ where: { id: jobId } }));
}

/** Cancels a dead-lettered job — a distinct terminal state from FAILED (see JobStatus.CANCELLED's schema comment), so it never runs again and never appears in future dead-letter listings, but reliability metrics can still tell "gave up" apart from "operator cancelled." Same atomic-conditional-transition safety as retry. */
export async function cancelDeadLetterJob(jobId: string, adminUserId: string, reason: string): Promise<DeadLetterJobSummary> {
  const claim = await prisma.job.updateMany({
    where: { id: jobId, status: 'FAILED' },
    data: { status: 'CANCELLED', lastError: `Cancelled by admin: ${reason}` },
  });
  if (claim.count !== 1) {
    const existing = await prisma.job.findUnique({ where: { id: jobId } });
    if (!existing) throw new NotFoundError('Job not found.');
    throw new ValidationError([{ field: 'status', code: 'INVALID_TRANSITION', message: `Job is not dead-lettered (current status: ${existing.status}) and cannot be cancelled.` }]);
  }
  logAdminJobAction('admin.job_cancelled', jobId, adminUserId, { reason });
  return toDeadLetterSummary(await prisma.job.findUniqueOrThrow({ where: { id: jobId } }));
}
