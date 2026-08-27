import { beforeAll, describe, expect, it } from 'vitest';
import { ensureSeeded, registerTestUser, createTestWorkspace, cleanupTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { getCurrentSubscription, transitionSubscription, changePlan, cancelSubscription, reactivateSubscription } from './subscription.service';
import { getBalance, recordUsage, assertSufficientCredits } from './credit-ledger.service';
import { checkAndTriggerUsageAlerts } from './usage-alert.service';
import { getOnboardingState, advanceOnboardingStep } from '../onboarding/onboarding.service';

/**
 * Phase 27 Section 13/14: the full commercial customer lifecycle
 * (REGISTER -> ONBOARD -> ACTIVATE -> USE AI -> LOW CREDIT -> CREDIT
 * EXHAUSTED -> UPGRADE -> ACTIVE -> CANCEL -> REACTIVATE) walked through as
 * ONE continuous, real scenario against real PostgreSQL — every individual
 * transition already has dedicated unit-level coverage elsewhere
 * (subscription-lifecycle.integration.test.ts, billing-exactly-once,
 * trial-and-credit-allowance, usage-alert.integration.test.ts); this file's
 * job is to prove the transitions compose correctly end to end, with audit
 * and entitlement checks at each step, not to re-litigate any single
 * transition's own edge cases.
 */
describe('Full customer lifecycle (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('REGISTER -> ONBOARD -> ACTIVATE -> USE AI -> LOW CREDIT -> EXHAUSTED -> UPGRADE -> ACTIVE -> CANCEL -> REACTIVATE, each step verified against real data', async () => {
    // REGISTER
    const owner = await registerTestUser('Lifecycle Journey Owner');

    // ONBOARD: workspace creation is itself the first real onboarding
    // milestone — FREE plan, real 100-credit grant, real Settings row.
    const ws = await createTestWorkspace(owner.accessToken, 'Lifecycle Journey Workspace');

    let subscription = await getCurrentSubscription(ws.workspaceId);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.plan.key).toBe('free');
    expect(await getBalance(ws.workspaceId)).toBe(100);

    let onboarding = await getOnboardingState(ws.workspaceId);
    expect(onboarding.status).toBe('IN_PROGRESS');

    // ACTIVATE: complete the onboarding step sequence — golden-path
    // activation (workspace + first workflow + first successful AI op) is
    // exhaustively proven separately in onboarding.integration.test.ts;
    // here we only need the onboarding STATUS transition itself.
    for (const step of ['profile_completed', 'plan_chosen', 'team_invited', 'first_workflow_run', 'completed'] as const) {
      // sequential step progression is the point
      await advanceOnboardingStep(ws.workspaceId, step, owner.userId);
    }
    onboarding = await getOnboardingState(ws.workspaceId);
    expect(onboarding.status).toBe('COMPLETED');

    // USE AI: a real credit-ledger charge via the same function every
    // AI-bearing workflow step uses.
    await recordUsage({ workspaceId: ws.workspaceId, userId: owner.userId, actionType: 'COPILOT_CHAT', creditsConsumed: 85 });
    expect(await getBalance(ws.workspaceId)).toBe(15);

    // LOW CREDIT: 85/100 = 85% >= the 80% threshold -> a real CREDITS_LOW notification.
    await checkAndTriggerUsageAlerts(ws.workspaceId);
    const lowCreditNotification = await prisma.notification.findFirst({ where: { workspaceId: ws.workspaceId, type: 'CREDITS_LOW' } });
    expect(lowCreditNotification).not.toBeNull();

    // CREDIT EXHAUSTED: consume the remainder -> balance 0 -> 100% threshold -> CREDITS_EXHAUSTED.
    await recordUsage({ workspaceId: ws.workspaceId, userId: owner.userId, actionType: 'COPILOT_CHAT', creditsConsumed: 15 });
    expect(await getBalance(ws.workspaceId)).toBe(0);
    await checkAndTriggerUsageAlerts(ws.workspaceId);
    const exhaustedNotification = await prisma.notification.findFirst({ where: { workspaceId: ws.workspaceId, type: 'CREDITS_EXHAUSTED' } });
    expect(exhaustedNotification).not.toBeNull();

    // ENTITLEMENT ENFORCEMENT: server-authoritative — a further AI action is
    // genuinely rejected, not merely UI-blocked.
    await expect(assertSufficientCredits(ws.workspaceId, 10)).rejects.toThrow();
    await expect(recordUsage({ workspaceId: ws.workspaceId, actionType: 'COPILOT_CHAT', creditsConsumed: 10 })).rejects.toThrow();
    // The blocked attempt is still logged for observability, at zero cost — never silently dropped, never charged.
    const blockedUsage = await prisma.aIUsage.findFirst({ where: { workspaceId: ws.workspaceId, status: 'BLOCKED_BY_CREDIT_LIMIT' } });
    expect(blockedUsage?.creditsConsumed).toBe(0);

    // INVALID TRANSITION: ACTIVE has no legal transition to TRIALING (a
    // subscription only starts TRIALING at creation, never re-enters it) —
    // this must be rejected, not silently coerced.
    const auditCountBeforeInvalid = await prisma.auditLog.count({ where: { workspaceId: ws.workspaceId, entityType: 'Subscription' } });
    await expect(transitionSubscription(ws.workspaceId, 'TRIALING', owner.userId)).rejects.toThrow();
    const auditCountAfterInvalid = await prisma.auditLog.count({ where: { workspaceId: ws.workspaceId, entityType: 'Subscription' } });
    expect(auditCountAfterInvalid).toBe(auditCountBeforeInvalid); // a REJECTED transition never gets audited as if it happened

    // UPGRADE: FREE -> PRO, applies immediately (an upgrade never violates the smaller plan's limits).
    const upgradeResult = await changePlan(ws.workspaceId, 'pro', owner.userId);
    expect(upgradeResult.applied).toBe(true);
    expect(upgradeResult.pending).toBe(false);
    subscription = await getCurrentSubscription(ws.workspaceId);
    expect(subscription.plan.key).toBe('pro');

    const upgradeAudit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, entityType: 'Subscription', action: 'BILLING_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((upgradeAudit?.newValue as { direction?: string } | null)?.direction).toBe('upgrade');
    const changedNotification = await prisma.notification.findFirst({ where: { workspaceId: ws.workspaceId, type: 'SUBSCRIPTION_CHANGED' } });
    expect(changedNotification).not.toBeNull();

    // ACTIVE: confirmed unchanged status through the upgrade.
    expect(subscription.status).toBe('ACTIVE');

    // CANCEL (at period end — the default, non-destructive path): status
    // stays ACTIVE, cancelAtPeriodEnd records real intent.
    const cancelResult = await cancelSubscription(ws.workspaceId, owner.userId, false);
    expect(cancelResult.subscription.status).toBe('ACTIVE');
    expect(cancelResult.subscription.cancelAtPeriodEnd).toBe(true);
    const canceledNotification = await prisma.notification.findFirst({ where: { workspaceId: ws.workspaceId, type: 'SUBSCRIPTION_CANCELED' } });
    expect(canceledNotification).not.toBeNull();
    const cancelAudit = await prisma.auditLog.findFirst({
      where: { workspaceId: ws.workspaceId, entityType: 'Subscription', action: 'BILLING_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect((cancelAudit?.newValue as { cancelAtPeriodEnd?: boolean } | null)?.cancelAtPeriodEnd).toBe(true);

    // REACTIVATE: reverses the scheduled cancellation, still ACTIVE throughout.
    const reactivated = await reactivateSubscription(ws.workspaceId, owner.userId);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
    expect(reactivated.status).toBe('ACTIVE');
    const reactivatedNotification = await prisma.notification.findFirst({ where: { workspaceId: ws.workspaceId, type: 'SUBSCRIPTION_REACTIVATED' } });
    expect(reactivatedNotification).not.toBeNull();

    // Real, live audit trail proof: every transition this journey performed
    // left a real, queryable BILLING_CHANGE record — not just returned promises.
    const fullAuditTrail = await prisma.auditLog.findMany({ where: { workspaceId: ws.workspaceId, entityType: 'Subscription' }, orderBy: { createdAt: 'asc' } });
    expect(fullAuditTrail.length).toBeGreaterThanOrEqual(4); // initial creation, upgrade, cancel, reactivate

    await cleanupTestUser(owner.email);
  });

  it('a terminal subscription state (EXPIRED) has zero legal outgoing transitions', async () => {
    const owner = await registerTestUser('Lifecycle Terminal State Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Lifecycle Terminal State Workspace');

    await cancelSubscription(ws.workspaceId, owner.userId, true); // immediate -> CANCELED
    const subscriptionId = (await getCurrentSubscription(ws.workspaceId)).id;
    await transitionSubscription(ws.workspaceId, 'EXPIRED', owner.userId); // CANCELED -> EXPIRED is legal

    // EXPIRED is deliberately excluded from getCurrentSubscription's "current"
    // set (Section 4: genuinely terminal) — read the raw row directly to confirm the real status.
    const rawSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(rawSubscription.status).toBe('EXPIRED');

    // No further transition is reachable — enforced both by the state
    // machine (no legal targets from EXPIRED) and, independently, by
    // getCurrentSubscription no longer finding a "current" row to act on.
    await expect(transitionSubscription(ws.workspaceId, 'ACTIVE', owner.userId)).rejects.toThrow();

    await cleanupTestUser(owner.email);
  });
});
