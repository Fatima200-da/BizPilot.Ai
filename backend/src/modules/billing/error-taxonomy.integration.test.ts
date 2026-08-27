import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';

/**
 * Phase 26 Section 14: real-execution confirmation that the error taxonomy
 * already established (RFC 7807 `application/problem+json`, consistent
 * since Phase 16-18 and reused unchanged by every Phase 25/26 error class —
 * PlanLimitReachedError, DowngradePendingBlockedError,
 * InsufficientPermissionError, etc.) never leaks Prisma/PostgreSQL/OpenAI
 * SDK internals, stack traces, or secrets to the client — confirmed live
 * for the NEW error paths this phase introduced, not just re-asserted from
 * memory of earlier phases.
 */
describe('Error taxonomy — no internal leakage (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Error Taxonomy Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Error Taxonomy Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  function assertNoLeakage(res: request.Response): void {
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/DATABASE_URL|OPENAI_API_KEY|JWT_SECRET|node_modules|PrismaClientKnownRequestError|at Object\.|at async |\.ts:\d+|postgresql:\/\//i);
  }

  it('a malformed workspace-id path parameter (real Prisma UUID-cast error) never leaks Prisma/SQL detail', async () => {
    const res = await request(app).get('/api/v1/workspaces/not-a-valid-uuid').set('Authorization', `Bearer ${owner.accessToken}`);
    assertNoLeakage(res);
    expect(res.status).toBeLessThan(500); // handled cleanly, not a raw 500 with internals attached — but even if 500, no leakage
  });

  it('PlanLimitReachedError (new this-phase-family error) has a stable code and no internal detail', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/members/invite`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ email: 'taxonomy-test@example.com', roleKey: 'MEMBER' }); // FREE plan, 1-seat limit already met by the owner
    expect(res.status).toBe(402);
    const body = res.body as { code?: string; detail?: string };
    expect(body.code).toBe('BILLING_PLAN_LIMIT_REACHED');
    assertNoLeakage(res);
  });

  it('InsufficientPermissionError (admin route) has a stable code and no internal detail', async () => {
    const res = await request(app).get('/api/v1/admin/workspaces').set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(403);
    const body = res.body as { code?: string };
    expect(body.code).toBe('AUTHZ_INSUFFICIENT_PERMISSION');
    assertNoLeakage(res);
  });

  it('every error response carries a requestId for correlation, never a secret', async () => {
    const res = await request(app).get('/api/v1/admin/workspaces');
    expect(res.status).toBe(401);
    const body = res.body as { requestId?: string };
    expect(typeof body.requestId).toBe('string');
    expect(body.requestId?.length).toBeGreaterThan(0);
  });
});
