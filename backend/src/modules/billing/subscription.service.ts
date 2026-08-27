import type { Prisma, PrismaClient, Subscription, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';

type TxClient = Prisma.TransactionClient | PrismaClient;
import { prisma } from '../../infrastructure/database/prisma';
import { InvalidStateTransitionError, NotFoundError } from '../../common/errors/app-error';
import { DowngradePendingBlockedError } from '../../common/errors/app-error';
import { grantCredits } from './credit-ledger.service';
import { createNotification } from '../notifications/notification.service';
import { trackEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

/** Resolves who should receive a subscription-lifecycle notification: the actor if known, else the workspace owner (e.g. a webhook-driven, system-initiated transition has no actor). Exported (Phase 29) for webhook.service.ts's own real payment-failure notification, which needs the identical resolution rule for the same reason (webhook-driven, no actor). */
export async function resolveNotificationRecipient(workspaceId: string, actorUserId: string | null): Promise<string> {
  if (actorUserId) return actorUserId;
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return workspace.ownerUserId;
}

/**
 * Phase 25 Section 4: the ONE authoritative subscription state machine.
 * `SubscriptionStatus` has existed in the schema since the earlier
 * architecture phases but no application code ever wrote or transitioned
 * it — every workspace previously got a flat AICredit grant and no
 * Subscription row at all (see workspace.service.ts before this phase).
 * This is the single place that writes `Subscription.status`; nothing else
 * in the codebase may set it directly.
 */
const LEGAL_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ['ACTIVE', 'EXPIRED', 'CANCELED'],
  ACTIVE: ['PAST_DUE', 'CANCELED', 'PAUSED'],
  PAST_DUE: ['ACTIVE', 'CANCELED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  CANCELED: ['EXPIRED'],
  EXPIRED: [],
};

function assertLegalTransition(from: SubscriptionStatus, to: SubscriptionStatus): void {
  if (from === to) return; // idempotent no-op, not an error
  if (!LEGAL_TRANSITIONS[from].includes(to)) {
    throw new InvalidStateTransitionError(`Subscription cannot transition from ${from} to ${to}.`);
  }
}

/**
 * Every transition is audited (Section 4: "Every transition must be
 * auditable") via the existing, immutable AuditLog model — reused rather
 * than introducing a redundant SubscriptionEvent table, since AuditLog
 * already has a BILLING_CHANGE action and a workspace-scoped, actor-scoped,
 * previousValue/newValue shape that is exactly this requirement.
 */
async function transition(
  tx: TxClient,
  subscription: Subscription,
  to: SubscriptionStatus,
  actorUserId: string | null,
  extra?: Record<string, unknown>
): Promise<Subscription> {
  assertLegalTransition(subscription.status, to);
  const updated = await tx.subscription.update({
    where: { id: subscription.id },
    data: { status: to, ...(to === 'CANCELED' ? { canceledAt: new Date() } : {}) },
  });
  await tx.auditLog.create({
    data: {
      workspaceId: subscription.workspaceId,
      actorUserId,
      action: 'BILLING_CHANGE',
      entityType: 'Subscription',
      entityId: subscription.id,
      previousValue: { status: subscription.status },
      newValue: { status: to, ...extra },
    },
  });
  return updated;
}

/**
 * Phase 25 Section 5: every workspace gets a deterministic initial
 * commercial state at creation time — never `subscription = NULL`. FREE has
 * no trial (it is free indefinitely); paid plans are entered via
 * `startTrial`/`changePlan` later.
 */
export async function createFreeSubscriptionForWorkspace(workspaceId: string, actorUserId: string | null): Promise<Subscription> {
  const freePlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: 'free' } });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.create({
      data: {
        workspaceId,
        planId: freePlan.id,
        status: 'ACTIVE',
        billingInterval: 'MONTHLY',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        provider: 'MANUAL',
      },
    });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: undefined,
        newValue: { status: 'ACTIVE', planKey: 'free' },
      },
    });
    return subscription;
  }).then(async (subscription) => {
    await grantCredits({
      workspaceId,
      amount: freePlan.aiCreditsPerMonth,
      type: 'PLAN_GRANT',
      note: `Initial ${freePlan.name} plan allowance.`,
      createdByUserId: actorUserId ?? undefined,
    });
    return subscription;
  });
}

export interface SubscriptionWithPlan extends Subscription {
  plan: SubscriptionPlan;
  pendingPlan: SubscriptionPlan | null;
}

/**
 * The one current commercial row for a workspace. TRIALING/ACTIVE/PAST_DUE/
 * PAUSED/CANCELED are all "current" — CANCELED is included because it is
 * not yet terminal: `cancelAtPeriodEnd`-style cancellation keeps a
 * subscription queryable and still legally transitions to EXPIRED (Section
 * 4), and an immediately-CANCELED subscription must still be visible so a
 * caller gets a correct `InvalidStateTransitionError` rather than a
 * misleading `NotFoundError` when attempting an illegal transition out of
 * it. Only EXPIRED is excluded — genuinely terminal, no further transition
 * exists to reach from it. Because Section 5 guarantees a subscription
 * always exists, this never returns null for a workspace created after
 * this phase (until its subscription reaches EXPIRED with no successor row
 * — not yet possible in this codebase, since nothing creates a successor
 * subscription after EXPIRED).
 */
export async function getCurrentSubscription(workspaceId: string): Promise<SubscriptionWithPlan> {
  const subscription = await prisma.subscription.findFirst({
    where: { workspaceId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED'] } },
    include: { plan: true, pendingPlan: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription) throw new NotFoundError('No active subscription found for this workspace.');
  return subscription;
}

export async function transitionSubscription(workspaceId: string, to: SubscriptionStatus, actorUserId: string | null): Promise<Subscription> {
  const subscription = await getCurrentSubscription(workspaceId);
  return prisma.$transaction((tx) => transition(tx, subscription, to, actorUserId));
}

/**
 * Phase 25 Section 12: upgrade/downgrade as a domain operation, never a raw
 * `planId` write. Upgrading (target plan's sortOrder >= current) applies
 * immediately — a bigger plan never violates the smaller plan's limits.
 * Downgrading checks the workspace's REAL current usage (member count,
 * business profile count) against the target plan's limits; if it would
 * violate them, the plan is NOT swapped — `pendingPlanId` records the
 * intended target and the workspace is blocked from creating MORE of the
 * over-limit resource (enforced by entitlement.service.ts) until it
 * becomes compliant, exactly Section 12's "never silently destroy customer
 * data" requirement, and re-checked on every subsequent call so a
 * workspace that becomes compliant later (e.g. removes members) can be
 * swapped without a second explicit action.
 */
export async function changePlan(
  workspaceId: string,
  targetPlanKey: string,
  actorUserId: string | null
): Promise<{ subscription: Subscription; applied: boolean; pending: boolean; reason?: string }> {
  const [subscription, targetPlan] = await Promise.all([
    getCurrentSubscription(workspaceId),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: targetPlanKey } }),
  ]);

  if (subscription.planId === targetPlan.id && subscription.pendingPlanId === null) {
    return { subscription, applied: true, pending: false };
  }

  const isUpgrade = targetPlan.sortOrder >= subscription.plan.sortOrder;

  if (isUpgrade) {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: { planId: targetPlan.id, pendingPlanId: null, pendingPlanNote: null },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorUserId,
          action: 'BILLING_CHANGE',
          entityType: 'Subscription',
          entityId: subscription.id,
          previousValue: { planKey: subscription.plan.key },
          newValue: { planKey: targetPlan.key, direction: 'upgrade' },
        },
      });
      return result;
    });
    await createNotification({
      workspaceId,
      recipientUserId: await resolveNotificationRecipient(workspaceId, actorUserId),
      category: 'BILLING',
      type: 'SUBSCRIPTION_CHANGED',
      title: `Your plan changed to ${targetPlan.name}`,
      relatedEntityType: 'Subscription',
      relatedEntityId: `${subscription.id}:${targetPlan.key}:${updated.updatedAt.toISOString()}`,
    });
    await trackEvent({ workspaceId, userId: actorUserId ?? undefined, eventName: PRODUCT_EVENTS.UPGRADE_COMPLETED, entityType: 'Subscription', entityId: subscription.id, properties: { fromPlanKey: subscription.plan.key, toPlanKey: targetPlan.key } });
    return { subscription: updated, applied: true, pending: false };
  }

  // Downgrade path — check real current usage against the target plan's limits.
  const [memberCount, businessProfileCount, workspaceCountForOwner] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId, status: 'ACTIVE', deletedAt: null } }),
    prisma.businessProfile.count({ where: { workspaceId, deletedAt: null } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }).then((ws) => prisma.workspace.count({ where: { ownerUserId: ws.ownerUserId, deletedAt: null } })),
  ]);

  const violations: string[] = [];
  if (targetPlan.maxTeamSeats !== null && memberCount > targetPlan.maxTeamSeats) {
    violations.push(`${String(memberCount)} team members exceed the ${targetPlan.name} plan's limit of ${String(targetPlan.maxTeamSeats)}.`);
  }
  if (targetPlan.maxBusinessProfiles !== null && businessProfileCount > targetPlan.maxBusinessProfiles) {
    violations.push(`${String(businessProfileCount)} business profiles exceed the ${targetPlan.name} plan's limit of ${String(targetPlan.maxBusinessProfiles)}.`);
  }
  if (targetPlan.maxWorkspaces !== null && workspaceCountForOwner > targetPlan.maxWorkspaces) {
    violations.push(`${String(workspaceCountForOwner)} workspaces exceed the ${targetPlan.name} plan's limit of ${String(targetPlan.maxWorkspaces)}.`);
  }

  if (violations.length > 0) {
    const reason = violations.join(' ');
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: { pendingPlanId: targetPlan.id, pendingPlanNote: reason },
      });
      await tx.auditLog.create({
        data: {
          workspaceId,
          actorUserId,
          action: 'BILLING_CHANGE',
          entityType: 'Subscription',
          entityId: subscription.id,
          previousValue: { planKey: subscription.plan.key },
          newValue: { pendingPlanKey: targetPlan.key, direction: 'downgrade_pending', reason },
        },
      });
      return result;
    });
    return { subscription: updated, applied: false, pending: true, reason };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.subscription.update({
      where: { id: subscription.id },
      data: { planId: targetPlan.id, pendingPlanId: null, pendingPlanNote: null },
    });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { planKey: subscription.plan.key },
        newValue: { planKey: targetPlan.key, direction: 'downgrade' },
      },
    });
    return result;
  });
  return { subscription: updated, applied: true, pending: false };
}

/** Re-checks a DOWNGRADE_PENDING subscription's compliance — called opportunistically (e.g. after a member is removed) so pending downgrades resolve without a second explicit user action. */
export async function retryPendingDowngrade(workspaceId: string, actorUserId: string | null): Promise<Subscription | null> {
  const subscription = await getCurrentSubscription(workspaceId);
  if (!subscription.pendingPlanId || !subscription.pendingPlan) return null;
  const result = await changePlan(workspaceId, subscription.pendingPlan.key, actorUserId);
  return result.applied ? result.subscription : null;
}

/** Throws if the workspace is DOWNGRADE_PENDING and blocked — call before creating another member/business-profile/workspace. */
export function assertNotDowngradeBlocked(subscription: SubscriptionWithPlan, resourceLabel: string): void {
  if (subscription.pendingPlanId) {
    throw new DowngradePendingBlockedError(
      `This workspace is over the limits of its pending ${subscription.pendingPlan?.name ?? 'target'} plan (${subscription.pendingPlanNote ?? 'reason unavailable'}). Remove excess ${resourceLabel} or cancel the pending downgrade before adding more.`
    );
  }
}

export interface CancelResult {
  subscription: Subscription;
}

/** Section 4/12: cancellation defaults to at-period-end (the deterministic, non-destructive default every real SaaS product uses) — status stays ACTIVE/TRIALING until the period ends, `cancelAtPeriodEnd` records intent. `immediate: true` transitions straight to CANCELED (e.g. for an admin/test path). */
export async function cancelSubscription(workspaceId: string, actorUserId: string | null, immediate = false): Promise<CancelResult> {
  const subscription = await getCurrentSubscription(workspaceId);
  const recipientUserId = await resolveNotificationRecipient(workspaceId, actorUserId);

  if (immediate) {
    const updated = await prisma.$transaction((tx) => transition(tx, subscription, 'CANCELED', actorUserId, { immediate: true }));
    await createNotification({
      workspaceId,
      recipientUserId,
      category: 'BILLING',
      type: 'SUBSCRIPTION_CANCELED',
      title: 'Your subscription has been canceled',
      relatedEntityType: 'Subscription',
      relatedEntityId: `${subscription.id}:${updated.updatedAt.toISOString()}`,
    });
    await trackEvent({ workspaceId, userId: actorUserId ?? undefined, eventName: PRODUCT_EVENTS.SUBSCRIPTION_CANCELED, entityType: 'Subscription', entityId: subscription.id, properties: { immediate: true } });
    return { subscription: updated };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd },
        newValue: { cancelAtPeriodEnd: true },
      },
    });
    return result;
  });
  await createNotification({
    workspaceId,
    recipientUserId,
    category: 'BILLING',
    type: 'SUBSCRIPTION_CANCELED',
    title: 'Your subscription will cancel at the end of the current billing period',
    relatedEntityType: 'Subscription',
    relatedEntityId: `${subscription.id}:${updated.updatedAt.toISOString()}`,
  });
  await trackEvent({ workspaceId, userId: actorUserId ?? undefined, eventName: PRODUCT_EVENTS.SUBSCRIPTION_CANCELED, entityType: 'Subscription', entityId: subscription.id, properties: { immediate: false } });
  return { subscription: updated };
}

/**
 * Phase 25 Section 8: the plan -> credit-allowance tie-in. Idempotent per
 * billing period — safe to call as often as needed (e.g. opportunistically
 * on login) without double-granting, determined by checking whether a
 * PLAN_GRANT already exists since `currentPeriodStart`, not by a separate
 * scheduler state table. Honesty note: no cron/scheduler infrastructure
 * exists in this codebase to call this automatically on a timer — it must
 * be invoked explicitly (e.g. by an operator script or a future scheduled
 * job), which is accurately reflected as a known limitation in this
 * phase's certification doc rather than silently assumed to run itself.
 */
export async function grantMonthlyCreditsIfDue(workspaceId: string): Promise<{ granted: boolean; amount: number }> {
  const subscription = await getCurrentSubscription(workspaceId);
  const alreadyGranted = await prisma.aICredit.findFirst({
    where: { workspaceId, type: 'PLAN_GRANT', createdAt: { gte: subscription.currentPeriodStart } },
  });
  if (alreadyGranted) return { granted: false, amount: 0 };

  await grantCredits({
    workspaceId,
    amount: subscription.plan.aiCreditsPerMonth,
    type: 'PLAN_GRANT',
    note: `Monthly ${subscription.plan.name} plan allowance for period starting ${subscription.currentPeriodStart.toISOString()}.`,
  });
  return { granted: true, amount: subscription.plan.aiCreditsPerMonth };
}

/** Reverses a scheduled (not-yet-effective) cancellation — deterministic un-cancel, still ACTIVE/TRIALING. */
export async function reactivateSubscription(workspaceId: string, actorUserId: string | null): Promise<Subscription> {
  const subscription = await getCurrentSubscription(workspaceId);
  if (!subscription.cancelAtPeriodEnd) return subscription;
  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: false } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { cancelAtPeriodEnd: true },
        newValue: { cancelAtPeriodEnd: false },
      },
    });
    return result;
  });
  await createNotification({
    workspaceId,
    recipientUserId: await resolveNotificationRecipient(workspaceId, actorUserId),
    category: 'BILLING',
    type: 'SUBSCRIPTION_REACTIVATED',
    title: 'Your subscription has been reactivated',
    relatedEntityType: 'Subscription',
    relatedEntityId: `${subscription.id}:${updated.updatedAt.toISOString()}`,
  });
  await trackEvent({ workspaceId, userId: actorUserId ?? undefined, eventName: PRODUCT_EVENTS.SUBSCRIPTION_REACTIVATED, entityType: 'Subscription', entityId: subscription.id });
  return updated;
}
