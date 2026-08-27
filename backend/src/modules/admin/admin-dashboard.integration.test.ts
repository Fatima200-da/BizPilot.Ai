import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

interface DashboardMetricsData {
  totalUsers: number;
  activeUsers30d: number;
  totalWorkspaces: number;
  subscriptionsByStatus: Record<string, number>;
  aiOperationsTotal: number;
  creditsConsumedTotal: number;
  workflowExecutionsTotal: number;
  workflowsFailedTotal: number;
  systemHealth: string;
}
interface UserSearchResultData {
  id: string;
  email: string;
  workspaces: Array<{ id: string; name: string; role: string; subscriptionStatus: string | null }>;
}

/**
 * Phase 27 Section 11: platform dashboard metrics + user search/browse,
 * layered onto Phase 26's admin control plane. Reuses the exact same
 * `requireSystemAdmin` gate — these tests focus on the DATA being real and
 * live, not re-proving the authorization matrix already covered
 * exhaustively in admin.integration.test.ts.
 */
describe('Admin dashboard metrics & user search (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let adminUser: Awaited<ReturnType<typeof registerTestUser>>;
  let adminAccessToken: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Admin Dashboard Target Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Admin Dashboard Target Workspace');

    adminUser = await registerTestUser('Admin Dashboard Platform Admin');
    await prisma.user.update({ where: { id: adminUser.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: 'password1234' });
    adminAccessToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
    await cleanupTestUser(adminUser.email);
  });

  it('GET /admin/dashboard is 401 unauthenticated, 403 for a non-admin, 200 with real live counts for an admin', async () => {
    const anon = await request(app).get('/api/v1/admin/dashboard');
    expect(anon.status).toBe(401);

    const nonAdmin = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(nonAdmin.status).toBe(403);

    const usersBefore = await prisma.user.count({ where: { deletedAt: null } });
    const res = await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);

    const metrics = data<DashboardMetricsData>(res);
    expect(metrics.totalUsers).toBe(usersBefore); // exact real count, not an approximation
    expect(metrics.totalWorkspaces).toBeGreaterThanOrEqual(1);
    expect(metrics.subscriptionsByStatus.ACTIVE).toBeGreaterThanOrEqual(1); // both test workspaces have real ACTIVE subscriptions
    expect(metrics.systemHealth).toBe('healthy'); // a real DB round-trip succeeded during this very request
  });

  it('dashboard totals genuinely change after a real registration — not a cached/stale snapshot', async () => {
    const before = data<DashboardMetricsData>(await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${adminAccessToken}`));

    const extra = await registerTestUser('Admin Dashboard Freshness Probe');
    const after = data<DashboardMetricsData>(await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${adminAccessToken}`));
    expect(after.totalUsers).toBe(before.totalUsers + 1);

    await cleanupTestUser(extra.email);
  });

  it('GET /admin/users is 403 for a non-admin, 200 with real workspace/subscription data for an admin', async () => {
    const nonAdmin = await request(app).get('/api/v1/admin/users').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(nonAdmin.status).toBe(403);

    const res = await request(app).get('/api/v1/admin/users').query({ q: owner.email }).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    const results = data<UserSearchResultData[]>(res);
    const found = results.find((u) => u.id === owner.userId);
    expect(found).toBeDefined();
    expect(found?.workspaces.some((w) => w.id === workspace.workspaceId && w.role === 'OWNER')).toBe(true);
  });
});
