import { randomUUID } from 'node:crypto';
import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 32 Track H/I: a real IDOR (Insecure Direct Object Reference) audit
 * and tenant-isolation matrix extension. `tenant-isolation.integration.test.ts`
 * (Phase 16-18) already covers contacts/leads/business-profiles/content-
 * assets/workflow-instances; this file covers the real, previously-
 * untested resource types found via a full route inventory of every
 * `:id`-parameterized endpoint in the backend: notification mark-read,
 * team member remove/role-change, invitation cancel, and scheduled-
 * workflow enable/disable. Every scenario is a REAL HTTP request with a
 * VALID token for workspace B, targeting a REAL resource ID that belongs
 * to workspace A — proving the server-side `workspaceId` scoping (sourced
 * from the verified JWT claim, never a client-supplied path/body value)
 * actually holds, not merely reading the service-layer code and assuming
 * it does.
 */
let emails: string[] = [];

async function cleanup(): Promise<void> {
  for (const email of emails) await cleanupTestUser(email).catch(() => undefined);
  emails = [];
}

describe('Phase 32 Track H/I: IDOR audit across previously-untested resource types', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('workspace B cannot mark workspace A\'s notification as read by guessing its ID', async () => {
    const ownerA = await registerTestUser('IDOR Notification Owner A');
    emails.push(ownerA.email);
    const wsA = await createTestWorkspace(ownerA.accessToken, 'IDOR Notif Workspace A');

    const notifA = await prisma.notification.create({
      data: { workspaceId: wsA.workspaceId, recipientUserId: ownerA.userId, category: 'AI', type: 'WORKFLOW_COMPLETED', channel: 'IN_APP', title: 'IDOR test notification' },
    });

    const ownerB = await registerTestUser('IDOR Notification Owner B');
    emails.push(ownerB.email);
    const wsB = await createTestWorkspace(ownerB.accessToken, 'IDOR Notif Workspace B');

    const res = await request(app)
      .patch(`/api/v1/notifications/${notifA.id}/read`)
      .set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(res.status).toBe(404); // scoped by recipientUserId server-side — B can never even see A's notification exists

    const stillUnread = await prisma.notification.findUnique({ where: { id: notifA.id } });
    expect(stillUnread?.readAt).toBeNull(); // never mutated by the cross-tenant attempt

    await cleanup();
  }, 20_000);

  // The 4 tests below are the REAL IDOR shape (distinct from a plain
  // cross-tenant path-mismatch, which `enforceWorkspacePathMatch` already
  // rejects at a coarser layer before any handler runs): the attacker uses
  // their OWN valid workspace path and their OWN valid token — a request
  // that legitimately passes every workspace-membership check — but
  // supplies a FOREIGN resource ID in the URL, testing whether the
  // service-layer lookup is genuinely scoped by the (server-verified)
  // `workspaceId`, or would resolve any ID handed to it.

  it('workspace B (own valid workspace + token) cannot remove workspace A\'s member by supplying A\'s real membership ID', async () => {
    const ownerA = await registerTestUser('IDOR Member Owner A');
    emails.push(ownerA.email);
    const wsA = await createTestWorkspace(ownerA.accessToken, 'IDOR Member Workspace A');
    const memberA = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: wsA.workspaceId, userId: ownerA.userId } });

    const ownerB = await registerTestUser('IDOR Member Owner B');
    emails.push(ownerB.email);
    const wsB = await createTestWorkspace(ownerB.accessToken, 'IDOR Member Workspace B');

    const res = await request(app)
      .delete(`/api/v1/workspaces/${wsB.workspaceId}/members/${memberA.id}`)
      .set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(res.status).toBe(404); // B's own valid path/token — A's member ID simply doesn't exist within B's scope

    const stillThere = await prisma.workspaceMember.findUnique({ where: { id: memberA.id } });
    expect(stillThere?.deletedAt).toBeNull();

    await cleanup();
  }, 20_000);

  it('workspace B (own valid workspace + token) cannot change workspace A\'s member role by supplying A\'s real membership ID', async () => {
    const ownerA = await registerTestUser('IDOR Role Owner A');
    emails.push(ownerA.email);
    const wsA = await createTestWorkspace(ownerA.accessToken, 'IDOR Role Workspace A');
    const memberA = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: wsA.workspaceId, userId: ownerA.userId } });

    const ownerB = await registerTestUser('IDOR Role Owner B');
    emails.push(ownerB.email);
    const wsB = await createTestWorkspace(ownerB.accessToken, 'IDOR Role Workspace B');

    const res = await request(app)
      .patch(`/api/v1/workspaces/${wsB.workspaceId}/members/${memberA.id}/role`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ roleKey: 'MEMBER' });
    expect(res.status).toBe(404);

    const stillOwner = await prisma.workspaceMember.findUnique({ where: { id: memberA.id }, include: { role: true } });
    expect(stillOwner?.role.key).toBe('OWNER'); // real proof the role was never actually changed

    await cleanup();
  }, 20_000);

  it('workspace B (own valid workspace + token) cannot cancel workspace A\'s pending invitation by supplying A\'s real invitation ID', async () => {
    const ownerA = await registerTestUser('IDOR Invite Owner A');
    emails.push(ownerA.email);
    const wsA = await createTestWorkspace(ownerA.accessToken, 'IDOR Invite Workspace A');
    const { changePlan } = await import('../billing/subscription.service');
    await changePlan(wsA.workspaceId, 'starter', ownerA.userId); // real seat-limit workaround, same pattern established in Phase 30's auth-hardening tests

    const inviteRes = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/members/invite`)
      .set('Authorization', `Bearer ${wsA.accessToken}`)
      .send({ email: `idor-invitee-${randomUUID()}@example.test`, roleKey: 'MEMBER' });
    expect(inviteRes.status).toBe(201);
    const inviteId = (inviteRes.body as { data: { id: string } }).data.id;

    const ownerB = await registerTestUser('IDOR Invite Owner B');
    emails.push(ownerB.email);
    const wsB = await createTestWorkspace(ownerB.accessToken, 'IDOR Invite Workspace B');

    const res = await request(app)
      .delete(`/api/v1/workspaces/${wsB.workspaceId}/invitations/${inviteId}`)
      .set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(res.status).toBe(404);

    const stillPending = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
    expect(stillPending?.status).toBe('PENDING');

    await cleanup();
  }, 20_000);

  it('workspace B (own valid workspace + token) cannot toggle workspace A\'s scheduled workflow by supplying A\'s real schedule ID', async () => {
    const ownerA = await registerTestUser('IDOR Schedule Owner A');
    emails.push(ownerA.email);
    const wsA = await createTestWorkspace(ownerA.accessToken, 'IDOR Schedule Workspace A');
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/business-profiles/`)
      .set('Authorization', `Bearer ${wsA.accessToken}`)
      .send({ name: 'IDOR Test Biz', industry: 'retail', description: 'x'.repeat(20) });
    const businessProfileId = (profileRes.body as { data: { id: string } }).data.id;

    const scheduleRes = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${wsA.accessToken}`)
      .send({ name: 'IDOR test schedule', workflowDefinitionKey: 'marketing-autopilot', businessProfileId, intervalUnit: 'DAY', timeOfDay: '09:00' });
    expect(scheduleRes.status).toBe(201);
    const scheduleId = (scheduleRes.body as { data: { id: string } }).data.id;

    const ownerB = await registerTestUser('IDOR Schedule Owner B');
    emails.push(ownerB.email);
    const wsB = await createTestWorkspace(ownerB.accessToken, 'IDOR Schedule Workspace B');

    const res = await request(app)
      .patch(`/api/v1/workspaces/${wsB.workspaceId}/scheduled-workflows/${scheduleId}/enabled`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ enabled: false });
    expect(res.status).toBe(404);

    const stillEnabled = await prisma.scheduledWorkflow.findUnique({ where: { id: scheduleId } });
    expect(stillEnabled?.enabled).toBe(true);

    await cleanup();
  }, 20_000);
});
