import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { getBalance, grantCredits } from './credit-ledger.service';

/**
 * Phase 24 Section 4 (HIGH-PRIORITY): exactly-once billing certification
 * against the real, HTTP-triggered Marketing Autopilot flow and the real
 * credit ledger. Complements credit-charge-ordering.integration.test.ts
 * (which drives the retry-billing invariant directly through the engine)
 * with the HTTP-level concurrency and credit-boundary scenarios this
 * phase's spec calls out explicitly: concurrent duplicate requests (F/G),
 * the exact credit boundary (L), and zero/insufficient credits (K/M).
 */
describe('Exactly-once AI billing (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let businessProfileId: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Billing Exactly-Once Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Billing Exactly-Once Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Billing Test Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    businessProfileId = (profileRes.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  const url = (): string => `/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`;
  const auth = (req: request.Test): request.Test => req.set('Authorization', `Bearer ${workspace.accessToken}`);

  it('F/G: concurrent duplicate HTTP requests with the same idempotencyKey run the workflow exactly once and charge credits exactly once', async () => {
    const balanceBefore = await getBalance(workspace.workspaceId);
    const idempotencyKey = 'concurrent-duplicate-start-test';

    const [resA, resB] = await Promise.all([
      auth(request(app).post(url())).send({ businessProfileId, idempotencyKey }),
      auth(request(app).post(url())).send({ businessProfileId, idempotencyKey }),
    ]);

    expect([resA.status, resB.status].sort()).toEqual([201, 201]); // both succeed — the loser gets the winner's row back, not an error
    const idA = (resA.body as { data: { id: string } }).data.id;
    const idB = (resB.body as { data: { id: string } }).data.id;
    expect(idA).toBe(idB); // exactly one logical instance

    const instances = await prisma.workflowInstance.count({ where: { workspaceId: workspace.workspaceId, idempotencyKey } });
    expect(instances).toBe(1); // exactly one row — no duplicate created by the race

    const usageForThisRun = await prisma.aIUsage.count({ where: { workspaceId: workspace.workspaceId, relatedEntityId: idA } });
    expect(usageForThisRun).toBe(3); // strategy + pillars + calendar — charged exactly once each, not twice

    const balanceAfter = await getBalance(workspace.workspaceId);
    expect(balanceBefore - balanceAfter).toBe(20); // 5 + 5 + 10, exactly once — not 40
  });

  it('K/M: zero credits — the AI step is rejected before the provider is called, and the run FAILs cleanly with no partial content', async () => {
    const owner2 = await registerTestUser('Zero Credit Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Zero Credit Workspace');
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws2.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${ws2.accessToken}`)
      .send({ name: 'Zero Credit Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    const profileId2 = (profileRes.body as { data: { id: string } }).data.id;

    const balance = await getBalance(ws2.workspaceId);
    await grantCredits({ workspaceId: ws2.workspaceId, amount: -balance, type: 'MANUAL_ADJUSTMENT', note: 'Phase 24 test: drain to exactly zero' });
    expect(await getBalance(ws2.workspaceId)).toBe(0);

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws2.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${ws2.accessToken}`)
      .send({ businessProfileId: profileId2 });

    expect(res.status).toBe(201); // the workflow itself starts (PENDING/RUNNING transition) — it's the AI step that fails
    const instance = (res.body as { data: { id: string; status: string } }).data;
    expect(instance.status).toBe('FAILED');

    expect(await getBalance(ws2.workspaceId)).toBe(0); // never went negative, never charged
    const contentAssets = await prisma.contentAsset.count({ where: { workspaceId: ws2.workspaceId } });
    expect(contentAssets).toBe(0); // no partial content persisted from a failed run

    await cleanupTestUser(owner2.email);
  });

  it('L: exact credit boundary — exactly enough for the first AI step (5), not enough for the second (needs 5 more) — charged once, then fails cleanly at zero balance', async () => {
    const owner3 = await registerTestUser('Boundary Credit Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Boundary Credit Workspace');
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws3.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${ws3.accessToken}`)
      .send({ name: 'Boundary Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    const profileId3 = (profileRes.body as { data: { id: string } }).data.id;

    const balance = await getBalance(ws3.workspaceId);
    await grantCredits({ workspaceId: ws3.workspaceId, amount: 5 - balance, type: 'MANUAL_ADJUSTMENT', note: 'Phase 24 test: set to exact boundary (5)' });
    expect(await getBalance(ws3.workspaceId)).toBe(5);

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws3.workspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${ws3.accessToken}`)
      .send({ businessProfileId: profileId3 });

    expect(res.status).toBe(201);
    const instance = (res.body as { data: { id: string; status: string; error?: { step: string } } }).data;
    expect(instance.status).toBe('FAILED'); // failed at the pillars step (needs 5, has 0 left)
    expect(instance.error).toMatchObject({ step: 'generate_pillars' });

    expect(await getBalance(ws3.workspaceId)).toBe(0); // charged exactly once for strategy (5), never went negative on pillars

    const usage = await prisma.aIUsage.findMany({ where: { workspaceId: ws3.workspaceId, relatedEntityId: instance.id } });
    expect(usage).toHaveLength(1); // only the strategy step actually charged — pillars was rejected pre-flight, no row written for it
    expect(usage[0]?.status).toBe('SUCCEEDED');
    expect(usage[0]?.creditsConsumed).toBe(5);

    await cleanupTestUser(owner3.email);
  });
});
