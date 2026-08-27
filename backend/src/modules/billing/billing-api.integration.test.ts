import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { createInvoice, openInvoice, markInvoicePaid } from './invoice.service';
import { getCurrentSubscription } from './subscription.service';

interface PlanData {
  key: string;
  tier: string;
}
interface SubscriptionData {
  status: string;
  plan: { key: string };
}
interface UsageData {
  aiCredits: { balance: number; monthlyAllowance: number };
  teamSeats: { used: number; limit: number | null };
}
interface InvoiceData {
  id: string;
  status: string;
  totalCents: number;
}

describe('Commercial billing API surface (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Billing API Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Billing API Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('GET /plans returns the real seeded catalog (unauthenticated request is rejected, authenticated succeeds)', async () => {
    const unauth = await request(app).get('/api/v1/plans');
    expect(unauth.status).toBe(401);

    const res = await request(app).get('/api/v1/plans').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const plans = data<PlanData[]>(res);
    expect(plans.map((p) => p.key).sort()).toEqual(['business', 'free', 'pro', 'starter']);
  });

  it('GET /subscription returns the real FREE subscription for a fresh workspace', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/subscription`).set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(res.status).toBe(200);
    const subscription = data<SubscriptionData>(res);
    expect(subscription.status).toBe('ACTIVE');
    expect(subscription.plan.key).toBe('free');
  });

  it('POST /subscription/upgrade moves the plan; the wrong-direction endpoint (downgrade) rejects the same target', async () => {
    const wrongDirection = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/subscription/downgrade`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ planKey: 'pro' });
    expect(wrongDirection.status).toBe(422);

    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/subscription/upgrade`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ planKey: 'pro' });
    expect(res.status).toBe(200);
    const body = res.body as { data: { applied: boolean; subscription: SubscriptionData } };
    expect(body.data.applied).toBe(true);
    expect(body.data.subscription.plan.key).toBe('pro');
  });

  it('GET /usage reflects the real, current PRO-plan entitlements and real AI credit balance', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/usage`).set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(res.status).toBe(200);
    const usage = data<UsageData>(res);
    expect(usage.teamSeats.limit).toBe(10); // PRO plan
    expect(usage.aiCredits.monthlyAllowance).toBe(2000); // PRO plan
    expect(usage.aiCredits.balance).toBeGreaterThan(0);
  });

  it('POST /subscription/cancel defaults to at-period-end; POST /subscription/reactivate reverses it', async () => {
    const cancelRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/subscription/cancel`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({});
    expect(cancelRes.status).toBe(200);
    const cancelBody = data<{ subscription: SubscriptionData & { cancelAtPeriodEnd: boolean; status: string } }>(cancelRes);
    expect(cancelBody.subscription.cancelAtPeriodEnd).toBe(true);
    expect(cancelBody.subscription.status).toBe('ACTIVE');

    const reactivateRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/subscription/reactivate`)
      .set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(reactivateRes.status).toBe(200);
    const reactivated = data<SubscriptionData & { cancelAtPeriodEnd: boolean }>(reactivateRes);
    expect(reactivated.cancelAtPeriodEnd).toBe(false);
  });

  it('a MEMBER cannot manage billing (403) even though they can read subscription/usage', async () => {
    const memberUser = await registerTestUser('Billing Test Member');
    const { inviteMember } = await import('../team/invitation.service');
    const { acceptInvitation } = await import('../team/invitation.service');
    const invite = await inviteMember(workspace.workspaceId, owner.userId, { email: memberUser.email, roleKey: 'MEMBER' });
    await acceptInvitation(invite.token, memberUser.userId, memberUser.email);
    const selectRes = await request(app).post(`/api/v1/workspaces/${workspace.workspaceId}/select`).set('Authorization', `Bearer ${memberUser.accessToken}`);
    const memberToken = (selectRes.body as { data: { accessToken: string } }).data.accessToken;

    const readRes = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/subscription`).set('Authorization', `Bearer ${memberToken}`);
    expect(readRes.status).toBe(200); // reading is fine for any member

    const mutateRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/subscription/upgrade`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ planKey: 'business' });
    expect(mutateRes.status).toBe(403); // only billing.manage (OWNER) can mutate

    const invoicesRes = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/billing/invoices`).set('Authorization', `Bearer ${memberToken}`);
    expect(invoicesRes.status).toBe(403);
  });

  it('Section 15: invoice domain — create, open, mark paid, list via the real API, integer cents throughout', async () => {
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    const invoice = await createInvoice(workspace.workspaceId, subscription.id, [{ type: 'SUBSCRIPTION', description: 'Pro plan — monthly', unitAmountCents: 9900 }]);
    expect(invoice.subtotalCents).toBe(9900);
    expect(invoice.totalCents).toBe(9900);
    expect(Number.isInteger(invoice.totalCents)).toBe(true); // never floating-point money

    await openInvoice(invoice.id);
    await markInvoicePaid(invoice.id);

    const listRes = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/billing/invoices`).set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(listRes.status).toBe(200);
    const invoices = data<InvoiceData[]>(listRes);
    const found = invoices.find((i) => i.id === invoice.id);
    expect(found).toBeDefined();
    expect(found?.status).toBe('PAID');
    expect(found?.totalCents).toBe(9900);
  });
});
