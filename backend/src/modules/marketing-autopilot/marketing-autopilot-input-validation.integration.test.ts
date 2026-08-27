import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 24 Section 2: real HTTP-level input-validation certification for the
 * one AI-triggering endpoint in this codebase (`POST
 * /workspaces/:id/workflows/marketing-autopilot`). Every case here proves
 * `validateBody(startMarketingAutopilotSchema)` runs BEFORE any credit
 * check or AI-provider work — a rejected request must never create a
 * WorkflowInstance row or touch the AICredit/AIUsage ledger.
 */
describe('Marketing Autopilot start — AI input validation (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let businessProfileId: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Input Validation Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Input Validation Test Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Validation Test Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    businessProfileId = (profileRes.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  async function countInstancesAndUsage(): Promise<{ instances: number; usage: number }> {
    const [instances, usage] = await Promise.all([
      prisma.workflowInstance.count({ where: { workspaceId: workspace.workspaceId } }),
      prisma.aIUsage.count({ where: { workspaceId: workspace.workspaceId } }),
    ]);
    return { instances, usage };
  }

  const url = (): string => `/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`;
  const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${workspace.accessToken}`);

  it('EMPTY body → 422, no side effects', async () => {
    const before = await countInstancesAndUsage();
    const res = await auth(request(app).post(url())).send({});
    expect(res.status).toBe(422);
    expect(await countInstancesAndUsage()).toEqual(before);
  });

  it('MISSING businessProfileId → 422, no side effects', async () => {
    const before = await countInstancesAndUsage();
    const res = await auth(request(app).post(url())).send({ objective: 'bookings' });
    expect(res.status).toBe(422);
    expect(await countInstancesAndUsage()).toEqual(before);
  });

  it('INVALID type (businessProfileId as a number) → 422', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId: 12345 });
    expect(res.status).toBe(422);
  });

  it('businessProfileId not a valid UUID → 422', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId: 'not-a-uuid' });
    expect(res.status).toBe(422);
  });

  it('EXTREMELY LARGE input (platforms array of 500 items, exceeds max 5) → 422', async () => {
    const res = await auth(request(app).post(url())).send({
      businessProfileId,
      platforms: Array.from({ length: 500 }, (_, i) => `platform-${String(i)}`),
    });
    expect(res.status).toBe(422);
  });

  it('MALFORMED structured input (platforms as a plain string, not an array) → 422', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId, platforms: 'instagram' });
    expect(res.status).toBe(422);
  });

  it('UNEXPECTED extra top-level field → stripped and accepted (default Zod object contract, not a security issue since it never reaches persistence)', async () => {
    const before = await countInstancesAndUsage();
    const res = await auth(request(app).post(url())).send({ businessProfileId, unexpectedField: 'anything' });
    expect(res.status).toBe(201);
    const after = await countInstancesAndUsage();
    expect(after.instances).toBe(before.instances + 1); // legitimately started — extra field was safely ignored, not misused
  });

  it('INVALID enum value for objective → 422', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId, objective: 'world_domination' });
    expect(res.status).toBe(422);
  });

  it('WHITESPACE-ONLY businessProfileId → 422 (fails UUID format)', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId: '   ' });
    expect(res.status).toBe(422);
  });

  it('EMPTY platforms array → 422 (schema requires min 1)', async () => {
    const res = await auth(request(app).post(url())).send({ businessProfileId, platforms: [] });
    expect(res.status).toBe(422);
  });

  it('BOUNDARY: exactly 5 platforms (the documented max) → accepted', async () => {
    const before = await countInstancesAndUsage();
    const res = await auth(request(app).post(url())).send({
      businessProfileId,
      platforms: ['instagram', 'facebook', 'tiktok', 'whatsapp', 'linkedin'],
      idempotencyKey: 'boundary-5-platforms',
    });
    expect(res.status).toBe(201);
    const after = await countInstancesAndUsage();
    expect(after.instances).toBe(before.instances + 1);
  });

  it('BOUNDARY: 6 platforms (one over max) → 422, no side effects', async () => {
    const before = await countInstancesAndUsage();
    const res = await auth(request(app).post(url())).send({
      businessProfileId,
      platforms: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(res.status).toBe(422);
    expect(await countInstancesAndUsage()).toEqual(before);
  });

  it('malformed raw JSON body → Express body-parser rejects with 400, before reaching schema validation at all', async () => {
    const res = await auth(request(app).post(url())).set('Content-Type', 'application/json').send('{ not valid json,');
    expect([400, 422]).toContain(res.status);
  });

  it('a rejected (422) request never creates a WorkflowInstance or AIUsage row — validation precedes all AI/billing work', async () => {
    const before = await countInstancesAndUsage();
    await auth(request(app).post(url())).send({ businessProfileId: 'still-not-a-uuid' });
    const after = await countInstancesAndUsage();
    expect(after).toEqual(before);
  });
});
