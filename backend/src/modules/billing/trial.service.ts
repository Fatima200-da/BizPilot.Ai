import type { Subscription } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, InvalidStateTransitionError } from '../../common/errors/app-error';
import { getCurrentSubscription, createFreeSubscriptionForWorkspace } from './subscription.service';

const TRIAL_DAYS = 14;

/**
 * Phase 25 Section 6: deterministic trial engine, layered on the same
 * `Subscription`/`SubscriptionStatus.TRIALING` the schema already defines
 * (no new model). A trial is not a new Subscription row — it is the
 * workspace's current subscription transitioning `ACTIVE(free) ->
 * TRIALING(targetPlan)`, which keeps the "exactly one current subscription
 * row per workspace" invariant intact.
 */

/**
 * Server-side eligibility check (Section 6: "Prevent users from repeatedly
 * creating trials through simple workspace/account manipulation"). Scoped
 * to the OWNER's account, not just this one workspace — otherwise a user
 * could bypass the one-trial policy by creating a fresh workspace for
 * every trial. Checked via the immutable AuditLog trail (every trial start
 * is audited with `newValue.direction: 'trial_start'`), not a mutable flag
 * a customer-facing API could tamper with.
 */
export async function isTrialEligible(workspaceId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const ownedWorkspaceIds = (await prisma.workspace.findMany({ where: { ownerUserId: workspace.ownerUserId }, select: { id: true } })).map((w) => w.id);

  const priorTrial = await prisma.auditLog.findFirst({
    where: {
      workspaceId: { in: ownedWorkspaceIds },
      entityType: 'Subscription',
      action: 'BILLING_CHANGE',
      newValue: { path: ['direction'], equals: 'trial_start' },
    },
  });
  return priorTrial === null;
}

export async function startTrial(workspaceId: string, targetPlanKey: string, actorUserId: string | null): Promise<Subscription> {
  const eligible = await isTrialEligible(workspaceId);
  if (!eligible) {
    throw new ConflictError('This account has already used its trial. Trials are limited to one per account.', 'BILLING_TRIAL_ALREADY_USED');
  }

  const subscription = await getCurrentSubscription(workspaceId);
  if (subscription.status !== 'ACTIVE' || subscription.plan.key !== 'free') {
    throw new InvalidStateTransitionError('A trial can only be started from the FREE plan\'s ACTIVE state.');
  }

  const targetPlan = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: targetPlanKey } });
  const trialEndsAt = new Date();
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_DAYS);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'TRIALING', planId: targetPlan.id, trialEndsAt },
    });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { status: 'ACTIVE', planKey: 'free' },
        newValue: { status: 'TRIALING', planKey: targetPlan.key, direction: 'trial_start', trialEndsAt: trialEndsAt.toISOString() },
      },
    });
    return updated;
  });
}

/** TRIALING -> ACTIVE: the trial converts to a paid subscription on the same plan. No real payment is collected (REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL) — this records the commercial state transition only. */
export async function convertTrial(workspaceId: string, actorUserId: string | null): Promise<Subscription> {
  const subscription = await getCurrentSubscription(workspaceId);
  if (subscription.status !== 'TRIALING') {
    throw new InvalidStateTransitionError('Only a TRIALING subscription can be converted.');
  }
  return prisma.$transaction(async (tx) => {
    const updated = await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', trialEndsAt: subscription.trialEndsAt } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { status: 'TRIALING' },
        newValue: { status: 'ACTIVE', direction: 'trial_converted' },
      },
    });
    return updated;
  });
}

/**
 * TRIALING -> EXPIRED when past `trialEndsAt`, then immediately creates a
 * fresh ACTIVE FREE subscription — Section 5's "never subscription = NULL"
 * invariant holds even through trial expiry, and Section 6's "expired-trial
 * behavior" is the workspace falling back to FREE, not being left in a
 * dead terminal state. Idempotent: calling this on an already-expired or
 * non-trialing subscription is a safe no-op (returns null).
 */
export async function expireTrialIfDue(workspaceId: string, actorUserId: string | null = null): Promise<Subscription | null> {
  const subscription = await getCurrentSubscription(workspaceId);
  if (subscription.status !== 'TRIALING' || !subscription.trialEndsAt || subscription.trialEndsAt > new Date()) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'BILLING_CHANGE',
        entityType: 'Subscription',
        entityId: subscription.id,
        previousValue: { status: 'TRIALING' },
        newValue: { status: 'EXPIRED', direction: 'trial_expired' },
      },
    });
  });

  return createFreeSubscriptionForWorkspace(workspaceId, actorUserId);
}
