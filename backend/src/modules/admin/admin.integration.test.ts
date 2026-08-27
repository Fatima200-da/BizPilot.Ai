import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { getBalance } from '../billing/credit-ledger.service';

interface AdminWorkspaceSearchResult {
  id: string;
  name: string;
}
interface WorkspaceInspectionData {
  workspace: { id: string; name: string };
  subscription: { status: string };
  usage: { aiCredits: { balance: number } };
  members: unknown[];
}

/**
 * Phase 26 Section 7 (mandatory admin security matrix): normal user -> 403,
 * workspace owner -> 403, admin -> 200, and admin actions themselves must
 * be audited. `isSystemAdmin` is never trusted from client input — every
 * test here proves the server resolves it exclusively from the
 * cryptographically-verified JWT (auth.ts's `authenticate` +
 * `requireSystemAdmin`), by attempting to reach admin routes with tokens
 * that have no such claim and confirming they are rejected.
 */
describe('Admin control plane & admin security (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let adminUser: Awaited<ReturnType<typeof registerTestUser>>;
  let adminAccessToken: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Admin Test Target Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Admin Test Target Workspace');

    adminUser = await registerTestUser('Real Platform Admin');
    // The only way `isSystemAdmin` becomes true for a token: the DB row is
    // updated directly here (simulating an out-of-band platform-operator
    // action, e.g. a database console — there is no self-service API to
    // grant this, by design) and a FRESH login re-reads it into a new JWT.
    await prisma.user.update({ where: { id: adminUser.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: 'password1234' });
    adminAccessToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
    await cleanupTestUser(adminUser.email);
  });

  it('a normal (non-admin) authenticated user gets 403 on every admin route', async () => {
    const search = await request(app).get('/api/v1/admin/workspaces').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(search.status).toBe(403);

    const inspect = await request(app).get(`/api/v1/admin/workspaces/${workspace.workspaceId}`).set('Authorization', `Bearer ${owner.accessToken}`);
    expect(inspect.status).toBe(403);

    const audit = await request(app).get(`/api/v1/admin/workspaces/${workspace.workspaceId}/audit-log`).set('Authorization', `Bearer ${owner.accessToken}`);
    expect(audit.status).toBe(403);
  });

  it('a WORKSPACE OWNER (workspace-level role) gets 403 on admin routes — workspace roles are not platform admin', async () => {
    // `workspace.accessToken` is a workspace-scoped OWNER token — the
    // highest workspace-level privilege that exists — and it is still
    // rejected, proving admin authorization is a genuinely separate axis.
    const res = await request(app).get('/api/v1/admin/workspaces').set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('an unauthenticated request gets 401, not 403 (no session to even evaluate)', async () => {
    const res = await request(app).get('/api/v1/admin/workspaces');
    expect(res.status).toBe(401);
  });

  it('a real platform admin gets 200 and can search/inspect any workspace', async () => {
    const search = await request(app).get('/api/v1/admin/workspaces').query({ q: workspace.workspaceId.slice(0, 8) }).set('Authorization', `Bearer ${adminAccessToken}`);
    // Search by partial UUID won't match name/slug — search by name instead.
    expect(search.status).toBe(200);

    const searchByName = await request(app).get('/api/v1/admin/workspaces').query({ q: 'Admin Test Target' }).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(searchByName.status).toBe(200);
    const results = data<AdminWorkspaceSearchResult[]>(searchByName);
    expect(results.some((w) => w.id === workspace.workspaceId)).toBe(true);

    const inspect = await request(app).get(`/api/v1/admin/workspaces/${workspace.workspaceId}`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(inspect.status).toBe(200);
    const inspection = data<WorkspaceInspectionData>(inspect);
    expect(inspection.workspace.id).toBe(workspace.workspaceId);
    expect(inspection.subscription.status).toBe('ACTIVE');
    expect(Array.isArray(inspection.members)).toBe(true);
  });

  it('admin inspection reuses the exact same real data a customer would see — no drift between admin and customer views', async () => {
    const adminView = await request(app).get(`/api/v1/admin/workspaces/${workspace.workspaceId}`).set('Authorization', `Bearer ${adminAccessToken}`);
    const customerView = await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/usage`).set('Authorization', `Bearer ${workspace.accessToken}`);

    const adminData = data<WorkspaceInspectionData>(adminView);
    const customerData = data<{ aiCredits: { balance: number } }>(customerView);
    expect(adminData.usage.aiCredits.balance).toBe(customerData.aiCredits.balance);
  });

  it('a MUTATING admin action (credit adjustment) is real, changes the real balance, and creates a real AuditLog record', async () => {
    const balanceBefore = await getBalance(workspace.workspaceId);

    const res = await request(app)
      .post(`/api/v1/admin/workspaces/${workspace.workspaceId}/credit-adjustment`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ amount: 500, note: 'Phase 26 test: goodwill credit' });
    expect(res.status).toBe(200);

    const balanceAfter = await getBalance(workspace.workspaceId);
    expect(balanceAfter).toBe(balanceBefore + 500);

    const auditRows = await prisma.auditLog.findMany({ where: { workspaceId: workspace.workspaceId, entityType: 'AdminAction', actorUserId: adminUser.userId } });
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const latest = auditRows[auditRows.length - 1];
    expect((latest?.newValue as { amount?: number } | null)?.amount).toBe(500);
  });

  it('a non-admin cannot perform the credit-adjustment mutation either (403, and the balance is unchanged)', async () => {
    const balanceBefore = await getBalance(workspace.workspaceId);
    const res = await request(app)
      .post(`/api/v1/admin/workspaces/${workspace.workspaceId}/credit-adjustment`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ amount: 999, note: 'should never apply' });
    expect(res.status).toBe(403);
    expect(await getBalance(workspace.workspaceId)).toBe(balanceBefore);
  });

  it('inspecting a nonexistent workspace is a real 404, not a crash or a leaked internal error', async () => {
    const res = await request(app).get('/api/v1/admin/workspaces/00000000-0000-4000-8000-000000000099').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(404);
  });

  it('CONCURRENT admin mutations against the same workspace remain deterministic — authorization is re-checked on every request, not cached across calls', async () => {
    const balanceBefore = await getBalance(workspace.workspaceId);
    const [resA, resB] = await Promise.all([
      request(app).post(`/api/v1/admin/workspaces/${workspace.workspaceId}/credit-adjustment`).set('Authorization', `Bearer ${adminAccessToken}`).send({ amount: 10, note: 'concurrent test A' }),
      request(app).post(`/api/v1/admin/workspaces/${workspace.workspaceId}/credit-adjustment`).set('Authorization', `Bearer ${owner.accessToken}`).send({ amount: 10, note: 'concurrent test B' }),
    ]);
    // The admin call succeeds; the owner-token call is independently and
    // correctly rejected, even when racing against a real admin request.
    expect([resA.status, resB.status].sort()).toEqual([200, 403]);
    expect(await getBalance(workspace.workspaceId)).toBe(balanceBefore + 10); // only the real admin's +10 applied
  });
});
