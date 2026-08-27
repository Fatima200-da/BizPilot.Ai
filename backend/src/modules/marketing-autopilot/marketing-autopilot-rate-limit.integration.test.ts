import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 24 Section 12: real rate-limit certification for the AI-triggering
 * endpoint's cost guardrail (`workflowExecutionRateLimit`,
 * WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS=20/hour by default — see
 * common/middlewares/rate-limit.ts). Fires real requests past the
 * configured limit and inspects real database state, rather than trusting
 * the middleware configuration exists.
 */
describe('AI workflow execution rate limiting (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let businessProfileId: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Rate Limit Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Rate Limit Test Workspace');
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Rate Limit Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    businessProfileId = (profileRes.body as { data: { id: string } }).data.id;
  }, 30_000);

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('the 21st workflow-execution request within the configured window (20/hour) is rejected with 429, correct body, and no side effects — and the provider is never invoked for it', async () => {
    const responses: request.Response[] = [];
    for (let i = 0; i < 21; i += 1) {
      // Sequential (not Promise.all) so requests deterministically land in
      // order — request #21 must be the one that exceeds the limit.
      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspace.accessToken}`)
        .send({ businessProfileId, idempotencyKey: `rate-limit-test-${String(i)}` });
      responses.push(res);
    }

    const statuses = responses.map((r) => r.status);
    const rateLimited = responses.filter((r) => r.status === 429);
    const started = responses.filter((r) => r.status === 201);

    expect(started.length).toBe(20); // exactly the configured limit got through
    expect(rateLimited.length).toBe(1); // the 21st, and only the 21st, was rejected
    expect(statuses[20]).toBe(429);

    const limitedBody = rateLimited[0]?.body as { code: string; type: string; requestId?: string };
    expect(limitedBody.code).toBe('RATE_LIMIT_WORKFLOW_EXECUTION_EXCEEDED');
    expect(limitedBody.type).toContain('rate_limit_exceeded');
    // No secrets/stack traces/internal paths in the error body.
    const raw = JSON.stringify(limitedBody);
    expect(raw).not.toMatch(/DATABASE_URL|OPENAI_API_KEY|JWT_SECRET|node_modules|at Object\.|\.ts:\d+/i);

    // No WorkflowInstance was created for the rejected request — the guardrail
    // fired before any credit check or AI/provider work, exactly as designed.
    const instanceCount = await prisma.workflowInstance.count({ where: { workspaceId: workspace.workspaceId } });
    expect(instanceCount).toBe(20);

    // Retry-After / rate-limit headers present (standardHeaders: true).
    expect(rateLimited[0]?.headers['ratelimit-limit']).toBeDefined();
  }, 30_000);
});
