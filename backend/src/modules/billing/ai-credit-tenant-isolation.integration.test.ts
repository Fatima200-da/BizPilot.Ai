import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { getBalance } from './credit-ledger.service';

/**
 * Phase 24 Section 11: tenant isolation for the AI credit ledger and usage
 * records specifically. docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md Section 8
 * noted every credit-ledger query is scoped by `workspaceId` but this had
 * never been proven with two real, simultaneously-active tenants each
 * genuinely consuming AI credits. There is no dedicated HTTP endpoint that
 * exposes AICredit/AIUsage directly (by design — see the audit), so this
 * drives isolation through the real, workspace-scoped
 * `credit-ledger.service.ts` functions plus the real HTTP workflow-trigger
 * endpoint for both tenants concurrently.
 */
describe('AI credit ledger tenant isolation (integration)', () => {
  let ownerA: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceA: Awaited<ReturnType<typeof createTestWorkspace>>;
  let profileIdA: string;
  let ownerB: Awaited<ReturnType<typeof registerTestUser>>;
  let workspaceB: Awaited<ReturnType<typeof createTestWorkspace>>;
  let profileIdB: string;

  beforeAll(async () => {
    await ensureSeeded();
    ownerA = await registerTestUser('Tenant A Owner');
    workspaceA = await createTestWorkspace(ownerA.accessToken, 'Tenant A Workspace');
    const profileResA = await request(app)
      .post(`/api/v1/workspaces/${workspaceA.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`)
      .send({ name: 'Tenant A Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    profileIdA = (profileResA.body as { data: { id: string } }).data.id;

    ownerB = await registerTestUser('Tenant B Owner');
    workspaceB = await createTestWorkspace(ownerB.accessToken, 'Tenant B Workspace');
    const profileResB = await request(app)
      .post(`/api/v1/workspaces/${workspaceB.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`)
      .send({ name: 'Tenant B Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    profileIdB = (profileResB.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('two tenants running AI workflows simultaneously never cross-affect each other\'s credit balance or usage records', async () => {
    const balanceABefore = await getBalance(workspaceA.workspaceId);
    const balanceBBefore = await getBalance(workspaceB.workspaceId);

    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/api/v1/workspaces/${workspaceA.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspaceA.accessToken}`)
        .send({ businessProfileId: profileIdA }),
      request(app)
        .post(`/api/v1/workspaces/${workspaceB.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspaceB.accessToken}`)
        .send({ businessProfileId: profileIdB }),
    ]);

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const instanceIdA = (resA.body as { data: { id: string } }).data.id;
    const instanceIdB = (resB.body as { data: { id: string } }).data.id;

    // Each tenant charged exactly its own 20 credits — not affected by the other's concurrent run.
    expect(balanceABefore - (await getBalance(workspaceA.workspaceId))).toBe(20);
    expect(balanceBBefore - (await getBalance(workspaceB.workspaceId))).toBe(20);

    // Direct SQL/Prisma verification: no AIUsage row for A references B's workspace or vice versa.
    const usageA = await prisma.aIUsage.findMany({ where: { relatedEntityId: instanceIdA } });
    const usageB = await prisma.aIUsage.findMany({ where: { relatedEntityId: instanceIdB } });
    expect(usageA.every((u) => u.workspaceId === workspaceA.workspaceId)).toBe(true);
    expect(usageB.every((u) => u.workspaceId === workspaceB.workspaceId)).toBe(true);
    expect(usageA.some((u) => u.workspaceId === workspaceB.workspaceId)).toBe(false);
    expect(usageB.some((u) => u.workspaceId === workspaceA.workspaceId)).toBe(false);

    // Tenant B cannot read Tenant A's AI-generated content (workflow instance + content assets) — anti-enumeration 404, not 403/leak.
    const crossRead = await request(app)
      .get(`/api/v1/workspaces/${workspaceB.workspaceId}/workflow-instances/${instanceIdA}`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(crossRead.status).toBe(404);

    // Tenant B cannot approve (and thereby trigger further billable steps on) Tenant A's instance.
    const crossApprove = await request(app)
      .post(`/api/v1/workspaces/${workspaceB.workspaceId}/workflow-instances/${instanceIdA}/approve`)
      .set('Authorization', `Bearer ${workspaceB.accessToken}`);
    expect(crossApprove.status).toBe(404);

    // And the reverse direction, for completeness.
    const crossReadReverse = await request(app)
      .get(`/api/v1/workspaces/${workspaceA.workspaceId}/workflow-instances/${instanceIdB}`)
      .set('Authorization', `Bearer ${workspaceA.accessToken}`);
    expect(crossReadReverse.status).toBe(404);

    // Neither tenant's balance moved as a side effect of the cross-tenant probes above.
    expect(await getBalance(workspaceA.workspaceId)).toBe(balanceABefore - 20);
    expect(await getBalance(workspaceB.workspaceId)).toBe(balanceBBefore - 20);
  });
});
