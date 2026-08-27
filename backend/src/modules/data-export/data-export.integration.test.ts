import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 32 Track O: real customer data export — functional correctness,
 * RBAC (owner/admin only, matching every other sensitive workspace
 * action), and a real IDOR check (workspace B's own valid token cannot
 * export workspace A's data).
 */
describe('Phase 32 Track O: workspace data export (integration)', () => {
  it('a real owner can export their own workspace data, receiving genuine business records and a real audit-log entry', async () => {
    await ensureSeeded();
    const owner = await registerTestUser('Data Export Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Data Export Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/business-profiles/`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ name: 'Export Test Biz', industry: 'retail', description: 'x'.repeat(20) });
    expect(profileRes.status).toBe(201);

    const contactRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ fullName: 'Export Test Contact' });
    expect(contactRes.status).toBe(201);

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/export`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { workspace: { id: string }; businessProfiles: unknown[]; contacts: unknown[]; exportedAt: string };
    expect(body.workspace.id).toBe(ws.workspaceId);
    expect(body.businessProfiles.length).toBe(1);
    expect(body.contacts.length).toBe(1);
    expect(body.exportedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { workspaceId: ws.workspaceId, action: 'DATA_EXPORT' } });
    expect(audit).toBeTruthy();
    expect(audit?.actorUserId).toBe(owner.userId);

    await cleanupTestUser(owner.email);
  }, 20_000);

  it('a real non-admin MEMBER cannot export workspace data (RBAC-gated, same as every other sensitive workspace action)', async () => {
    const owner = await registerTestUser('Data Export RBAC Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Data Export RBAC Workspace');
    const { changePlan } = await import('../billing/subscription.service');
    await changePlan(ws.workspaceId, 'starter', owner.userId);

    const member = await registerTestUser('Data Export RBAC Member');
    const { addWorkspaceMemberWithRole } = await import('../../testing/integration-helpers');
    const memberAuth = await addWorkspaceMemberWithRole(ws.workspaceId, member.userId, 'MEMBER');

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/export`).set('Authorization', `Bearer ${memberAuth.accessToken}`);
    expect(res.status).toBe(403);

    await cleanupTestUser(owner.email);
    await cleanupTestUser(member.email);
  }, 20_000);

  it('workspace B (own valid workspace + token) cannot export workspace A\'s data by targeting A\'s workspace ID', async () => {
    const ownerA = await registerTestUser('Data Export IDOR Owner A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Data Export IDOR Workspace A');

    const ownerB = await registerTestUser('Data Export IDOR Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Data Export IDOR Workspace B');

    // B's own valid, correctly-authenticated request — but targeting A's real workspace ID in the path. Rejected as an
    // indistinguishable 404 — the same established pattern tenant-isolation.integration.test.ts already certified
    // for cross-workspace access (never leaking "this resource exists but isn't yours" via a 403).
    const res = await request(app).get(`/api/v1/workspaces/${wsA.workspaceId}/export`).set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(res.status).toBe(404);

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  }, 20_000);
});
