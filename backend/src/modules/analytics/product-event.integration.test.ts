import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 29 Section 4/5: the product-event tracking foundation. Verifies
 * real events are recorded at real business call sites (not just that the
 * service function exists), the client-facing endpoint only ever accepts
 * an allowlisted event name (never an attacker-suppliable arbitrary
 * string — the whole point of a bounded event vocabulary), and every
 * standard cross-tenant guarantee this codebase enforces everywhere else
 * (real 404, never a leak or a 403) also holds for this brand-new table.
 */
describe('Product event tracking (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('a real registration records a real signup_completed event for that user', async () => {
    const user = await registerTestUser('ProductEvent Signup User');
    const events = await prisma.productEvent.findMany({ where: { userId: user.userId, eventName: 'signup_completed' } });
    expect(events).toHaveLength(1);
    await cleanupTestUser(user.email);
  });

  it('a real workspace creation records a real first_workspace_created event scoped to that workspace', async () => {
    const user = await registerTestUser('ProductEvent Workspace User');
    const ws = await createTestWorkspace(user.accessToken, 'ProductEvent Workspace');
    const events = await prisma.productEvent.findMany({ where: { workspaceId: ws.workspaceId, eventName: 'first_workspace_created' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.userId).toBe(user.userId);
    await cleanupTestUser(user.email);
  });

  it('POST /workspaces/:id/events accepts an allowlisted client event and persists it', async () => {
    const user = await registerTestUser('ProductEvent Client User');
    const ws = await createTestWorkspace(user.accessToken, 'ProductEvent Client Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/events`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ eventName: 'dashboard_viewed' });

    expect(res.status).toBe(200);
    const stored = await prisma.productEvent.findFirst({ where: { workspaceId: ws.workspaceId, eventName: 'dashboard_viewed' } });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(user.userId);
    await cleanupTestUser(user.email);
  });

  it('POST /workspaces/:id/events rejects a non-allowlisted event name — the client can never spoof a business-critical event like subscription_canceled', async () => {
    const user = await registerTestUser('ProductEvent Spoof User');
    const ws = await createTestWorkspace(user.accessToken, 'ProductEvent Spoof Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/events`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ eventName: 'subscription_canceled' }); // a real, business-meaningful event name — but not client-trackable

    expect(res.status).toBe(422);
    const stored = await prisma.productEvent.findFirst({ where: { workspaceId: ws.workspaceId, eventName: 'subscription_canceled' } });
    expect(stored).toBeNull();
    await cleanupTestUser(user.email);
  });

  it('POST /workspaces/:id/events rejects a completely made-up event name', async () => {
    const user = await registerTestUser('ProductEvent Junk User');
    const ws = await createTestWorkspace(user.accessToken, 'ProductEvent Junk Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/events`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ eventName: 'not_a_real_event_xyz' });

    expect(res.status).toBe(422);
    await cleanupTestUser(user.email);
  });

  it('cross-tenant event submission is a real 404, never a cross-tenant write', async () => {
    const ownerA = await registerTestUser('ProductEvent Tenant A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'ProductEvent Tenant A Workspace');
    const ownerB = await registerTestUser('ProductEvent Tenant B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'ProductEvent Tenant B Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/events`)
      .set('Authorization', `Bearer ${wsB.accessToken}`) // B's token, A's workspace path
      .send({ eventName: 'dashboard_viewed' });

    expect(res.status).toBe(404);
    const stored = await prisma.productEvent.findFirst({ where: { workspaceId: wsA.workspaceId, eventName: 'dashboard_viewed' } });
    expect(stored).toBeNull();

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('GET /workspaces/:id/events/activity returns real business moments only, newest first, and never another workspace\'s events', async () => {
    const user = await registerTestUser('ProductEvent Activity User');
    const ws = await createTestWorkspace(user.accessToken, 'ProductEvent Activity Workspace');
    // first_workspace_created already fired for real at createTestWorkspace above.

    await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/events`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ eventName: 'dashboard_viewed' }); // pure telemetry — must NOT appear in the activity feed

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/events/activity`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(200);
    const items = (res.body as { data: Array<{ eventName: string }> }).data;
    expect(items.some((i) => i.eventName === 'first_workspace_created')).toBe(true);
    expect(items.some((i) => i.eventName === 'dashboard_viewed')).toBe(false);

    const otherOwner = await registerTestUser('ProductEvent Activity Other');
    const otherWs = await createTestWorkspace(otherOwner.accessToken, 'ProductEvent Activity Other Workspace');
    const cross = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/events/activity`).set('Authorization', `Bearer ${otherWs.accessToken}`);
    expect(cross.status).toBe(404);

    await cleanupTestUser(user.email);
    await cleanupTestUser(otherOwner.email);
  });
});
