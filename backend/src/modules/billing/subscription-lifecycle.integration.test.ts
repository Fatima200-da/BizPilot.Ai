import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { getCurrentSubscription, changePlan, cancelSubscription, reactivateSubscription, transitionSubscription } from './subscription.service';
import { getLimit, canUseFeature, assertEntitled, assertFeatureEntitled } from './entitlement.service';
import { getBalance } from './credit-ledger.service';
import { PlanLimitReachedError, InvalidStateTransitionError, DowngradePendingBlockedError } from '../../common/errors/app-error';

/**
 * Phase 25 Sections 4, 5, 12: real, database-backed certification of the
 * subscription state machine, the deterministic FREE-plan initial state,
 * the entitlement engine, and the upgrade/downgrade compliance-blocking
 * behavior — against a real PostgreSQL database, not PGlite-only.
 */
describe('Subscription lifecycle & entitlement engine (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Subscription Lifecycle Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Subscription Lifecycle Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('Section 5: a newly created workspace never has subscription = NULL — it gets a real ACTIVE Subscription to the FREE plan', async () => {
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.plan.key).toBe('free');
    expect(subscription.plan.tier).toBe('FREE');

    const row = await prisma.subscription.findFirst({ where: { workspaceId: workspace.workspaceId } });
    expect(row).not.toBeNull();
  });

  it('Section 5/8: the initial AI credit grant is driven by the plan\'s aiCreditsPerMonth, not a hardcoded flat number', async () => {
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    const balance = await getBalance(workspace.workspaceId);
    expect(balance).toBe(subscription.plan.aiCreditsPerMonth);
  });

  it('Section 4: legal transition ACTIVE -> PAST_DUE succeeds and is audited', async () => {
    const updated = await transitionSubscription(workspace.workspaceId, 'PAST_DUE', owner.userId);
    expect(updated.status).toBe('PAST_DUE');

    const auditRow = await prisma.auditLog.findFirst({
      where: { workspaceId: workspace.workspaceId, entityType: 'Subscription', entityId: updated.id, action: 'BILLING_CHANGE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditRow).not.toBeNull();
    expect((auditRow?.newValue as { status?: string } | null)?.status).toBe('PAST_DUE');
  });

  it('Section 4: legal transition PAST_DUE -> ACTIVE (recovery) succeeds', async () => {
    const updated = await transitionSubscription(workspace.workspaceId, 'ACTIVE', owner.userId);
    expect(updated.status).toBe('ACTIVE');
  });

  it('Section 4: illegal transition ACTIVE -> EXPIRED is rejected — never an arbitrary status write', async () => {
    await expect(transitionSubscription(workspace.workspaceId, 'EXPIRED', owner.userId)).rejects.toThrow(InvalidStateTransitionError);
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE'); // unchanged after the rejected attempt
  });

  it('Section 4: CANCELED -> EXPIRED is legal but CANCELED -> ACTIVE is not (terminal-adjacent correctness)', async () => {
    const owner2 = await registerTestUser('Cancel Transition Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Cancel Transition Workspace');
    await transitionSubscription(ws2.workspaceId, 'CANCELED', owner2.userId);
    await expect(transitionSubscription(ws2.workspaceId, 'ACTIVE', owner2.userId)).rejects.toThrow(InvalidStateTransitionError);
    const expired = await transitionSubscription(ws2.workspaceId, 'EXPIRED', owner2.userId);
    expect(expired.status).toBe('EXPIRED');
    await cleanupTestUser(owner2.email);
  });

  it('Section 3: entitlement engine reports correct FREE-plan limits and remaining capacity', async () => {
    const seatStatus = await getLimit(workspace.workspaceId, 'teamSeats');
    expect(seatStatus.limit).toBe(1); // FREE plan seed value
    expect(seatStatus.used).toBe(1); // the owner themselves
    expect(seatStatus.remaining).toBe(0);
  });

  it('Section 3: canUseFeature correctly reflects the FREE plan\'s feature matrix (advancedAnalytics disabled)', async () => {
    const enabled = await canUseFeature(workspace.workspaceId, 'advancedAnalytics');
    expect(enabled).toBe(false);
    await expect(assertFeatureEntitled(workspace.workspaceId, 'advancedAnalytics')).rejects.toThrow(PlanLimitReachedError);
  });

  it('Section 3: assertEntitled throws PlanLimitReachedError when the FREE plan\'s 1-seat limit is already met', async () => {
    await expect(assertEntitled(workspace.workspaceId, 'teamSeats')).rejects.toThrow(PlanLimitReachedError);
  });

  it('Section 12: upgrade FREE -> PRO applies immediately and unlocks entitlements', async () => {
    const result = await changePlan(workspace.workspaceId, 'pro', owner.userId);
    expect(result.applied).toBe(true);
    expect(result.pending).toBe(false);

    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.plan.key).toBe('pro');

    const enabled = await canUseFeature(workspace.workspaceId, 'advancedAnalytics');
    expect(enabled).toBe(true); // PRO plan enables it

    const seatStatus = await getLimit(workspace.workspaceId, 'teamSeats');
    expect(seatStatus.limit).toBe(10); // PRO plan seed value
  });

  it('Section 12: downgrading PRO -> STARTER when over the STARTER member limit enters a blocked, non-destructive pending state — no data is deleted', async () => {
    const ownerRole = await prisma.role.findFirstOrThrow({ where: { workspaceId: null, key: 'MEMBER' } });
    // Add 3 more members (owner + 3 = 4 total) — exceeds STARTER's 3-seat limit.
    const extraMembers = await Promise.all(
      Array.from({ length: 3 }, async (_, i) => {
        const u = await registerTestUser(`Downgrade Extra Member ${String(i)}`);
        return prisma.workspaceMember.create({
          data: { workspaceId: workspace.workspaceId, userId: u.userId, roleId: ownerRole.id, status: 'ACTIVE', moduleScope: [], joinedAt: new Date() },
        });
      })
    );
    expect(extraMembers).toHaveLength(3);

    const memberCountBefore = await prisma.workspaceMember.count({ where: { workspaceId: workspace.workspaceId, status: 'ACTIVE', deletedAt: null } });
    expect(memberCountBefore).toBe(4);

    const result = await changePlan(workspace.workspaceId, 'starter', owner.userId);
    expect(result.applied).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.reason).toMatch(/team members exceed/);

    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.plan.key).toBe('pro'); // NOT swapped — still on PRO, the higher plan
    expect(subscription.pendingPlanId).not.toBeNull();

    // Data integrity: no member was deleted by the downgrade attempt.
    const memberCountAfter = await prisma.workspaceMember.count({ where: { workspaceId: workspace.workspaceId, status: 'ACTIVE', deletedAt: null } });
    expect(memberCountAfter).toBe(4);
  });

  it('Section 12: while DOWNGRADE_PENDING, assertNotDowngradeBlocked-style enforcement rejects adding a new resource', async () => {
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.pendingPlanId).not.toBeNull();
    // Re-import the guard directly to prove it reads the live pending state.
    const { assertNotDowngradeBlocked } = await import('./subscription.service');
    expect(() => {
      assertNotDowngradeBlocked(subscription, 'team members');
    }).toThrow(DowngradePendingBlockedError);
  });

  it('Section 12: cancellation defaults to at-period-end (deterministic, non-destructive) and can be reactivated', async () => {
    const owner3 = await registerTestUser('Cancel Reactivate Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Cancel Reactivate Workspace');

    const cancelResult = await cancelSubscription(ws3.workspaceId, owner3.userId);
    expect(cancelResult.subscription.cancelAtPeriodEnd).toBe(true);
    expect(cancelResult.subscription.status).toBe('ACTIVE'); // still active until period end — deterministic, not immediately terminated

    const reactivated = await reactivateSubscription(ws3.workspaceId, owner3.userId);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
    expect(reactivated.status).toBe('ACTIVE');

    await cleanupTestUser(owner3.email);
  });
});
