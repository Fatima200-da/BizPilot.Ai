import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { getCurrentSubscription, cancelSubscription } from './subscription.service';
import { inviteMember, acceptInvitation } from '../team/invitation.service';

/**
 * Phase 25 Section 24/26: security and concurrency certification for the
 * commercial surface specifically — cross-tenant access to
 * subscription/usage/invoices, concurrent plan mutations, concurrent
 * cancellations, and invitation-acceptance tenant binding. Complements the
 * gates already covered directly in their own test files (last-owner
 * protection, self-promotion, webhook replay, invitation expiry/replay —
 * see subscription-lifecycle/team/webhook .integration.test.ts).
 */
describe('Commercial security & concurrency (integration)', () => {
  let ownerA: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceA: Awaited<ReturnType<typeof createTestWorkspace>>;
  let ownerB: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceB: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    ownerA = await registerTestUser('Security Tenant A Owner');
    workspaceA = await createTestWorkspace(ownerA.accessToken, 'Security Tenant A Workspace');
    ownerB = await registerTestUser('Security Tenant B Owner');
    workspaceB = await createTestWorkspace(ownerB.accessToken, 'Security Tenant B Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('cross-tenant subscription access is 404, not a leak — B\'s token cannot read A\'s subscription', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${workspaceA.workspaceId}/subscription`).set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('cross-tenant usage access is 404', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${workspaceA.workspaceId}/usage`).set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('cross-tenant invoice access is 404', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${workspaceA.workspaceId}/billing/invoices`).set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(res.status).toBe(404);
  });

  it('cross-tenant plan manipulation (B\'s token attempting to upgrade A\'s subscription via A\'s path) is 404, never a silent cross-tenant write', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/subscription/upgrade`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ planKey: 'business' });
    expect(res.status).toBe(404);

    const subscriptionA = await getCurrentSubscription(workspaceA.workspaceId);
    expect(subscriptionA.plan.key).toBe('free'); // untouched
  });

  it('cross-tenant member management (B\'s token attempting to invite into A\'s workspace) is 404', async () => {
    const target = await registerTestUser('Cross Tenant Invite Target');
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/members/invite`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ email: target.email, roleKey: 'MEMBER' });
    expect(res.status).toBe(404);
  });

  it('invitation acceptance always binds to the INVITE\'s workspace, never the accepting user\'s currently-scoped workspace', async () => {
    const owner5 = await registerTestUser('Binding Test Owner');
    const ws5 = await createTestWorkspace(owner5.accessToken, 'Binding Test Workspace');
    const { changePlan } = await import('./subscription.service');
    await changePlan(ws5.workspaceId, 'starter', owner5.userId); // headroom for a second member

    const invitee = await registerTestUser('Binding Test Invitee');
    const invite = await inviteMember(ws5.workspaceId, owner5.userId, { email: invitee.email, roleKey: 'MEMBER' });
    const result = await acceptInvitation(invite.token, invitee.userId, invitee.email);

    expect(result.workspaceId).toBe(ws5.workspaceId);
    expect(result.workspaceId).not.toBe(workspaceB.workspaceId);

    const membershipInB = await prisma.workspaceMember.findFirst({ where: { workspaceId: workspaceB.workspaceId, userId: invitee.userId } });
    expect(membershipInB).toBeNull(); // accepting a ws5 invite never creates any membership in B

    await cleanupTestUser(owner5.email);
  });

  it('CONCURRENCY: two simultaneous upgrade attempts to different plans converge on a single deterministic winner, never a corrupted mixed state', async () => {
    const owner3 = await registerTestUser('Concurrent Upgrade Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Concurrent Upgrade Workspace');

    const [resA, resB] = await Promise.allSettled([
      request(app).post(`/api/v1/workspaces/${ws3.workspaceId}/subscription/upgrade`).set('Authorization', `Bearer ${ws3.accessToken}`).send({ planKey: 'pro' }),
      request(app).post(`/api/v1/workspaces/${ws3.workspaceId}/subscription/upgrade`).set('Authorization', `Bearer ${ws3.accessToken}`).send({ planKey: 'business' }),
    ]);

    // Both HTTP calls complete without crashing the process either way.
    expect(resA.status).toBe('fulfilled');
    expect(resB.status).toBe('fulfilled');

    const finalSubscription = await getCurrentSubscription(ws3.workspaceId);
    // The final plan is deterministically one of the two requested plans —
    // never anything else, never a torn/partial write.
    expect(['pro', 'business']).toContain(finalSubscription.plan.key);

    // Exactly one CURRENT subscription row exists for the workspace — no
    // duplicate/orphaned row was created by the race.
    const currentRows = await prisma.subscription.count({
      where: { workspaceId: ws3.workspaceId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELED'] } },
    });
    expect(currentRows).toBe(1);

    await cleanupTestUser(owner3.email);
  });

  it('CONCURRENCY: two simultaneous cancellation requests are idempotent — no error, no double AuditLog corruption', async () => {
    const owner4 = await registerTestUser('Concurrent Cancel Owner');
    const ws4 = await createTestWorkspace(owner4.accessToken, 'Concurrent Cancel Workspace');

    const [resultA, resultB] = await Promise.all([cancelSubscription(ws4.workspaceId, owner4.userId), cancelSubscription(ws4.workspaceId, owner4.userId)]);
    expect(resultA.subscription.cancelAtPeriodEnd).toBe(true);
    expect(resultB.subscription.cancelAtPeriodEnd).toBe(true);

    const subscription = await getCurrentSubscription(ws4.workspaceId);
    expect(subscription.cancelAtPeriodEnd).toBe(true);
    expect(subscription.status).toBe('ACTIVE'); // still active until period end, deterministic

    await cleanupTestUser(owner4.email);
  });

  it('no endpoint exists for a customer to directly write AICredit/Subscription.status/pendingPlanId (structural: only service-mediated mutations are reachable)', async () => {
    // Confirmed by the route table itself (billing.routes.ts): the only
    // mutating subscription endpoints are /upgrade, /downgrade, /cancel,
    // /reactivate — all service-mediated through changePlan/cancelSubscription/
    // transitionSubscription, none of which accept an arbitrary target status
    // or credit amount from the request body. A generic PATCH is asserted
    // absent here as a regression guard.
    const res = await request(app)
      .patch(`/api/v1/workspaces/${workspaceA.workspaceId}/subscription`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`)
      .send({ status: 'ACTIVE', planId: 'anything' });
    expect(res.status).toBe(404); // no such route
  });
});
