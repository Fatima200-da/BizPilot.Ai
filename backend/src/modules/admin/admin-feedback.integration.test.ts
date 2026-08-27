import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

interface FeedbackData {
  id: string;
  workspaceId: string;
  status: string;
}

/**
 * Phase 29 Section 24/9: the admin-side, cross-tenant feedback surface
 * (`GET /admin/feedback`, `PATCH /admin/feedback/:id/status`) is gated by
 * the same `requireSystemAdmin` chain proven for dead-letter jobs
 * (admin-dead-letter-jobs.integration.test.ts), but had no direct test
 * exercising it — this closes that gap: non-admin rejection, real
 * cross-tenant visibility (the admin's whole purpose here), a forged/
 * nonexistent feedbackId rejected as a real 404, and a real audit trail
 * for the status change.
 */
describe('Admin feedback operations (integration)', () => {
  let adminAccessToken: string;
  let adminEmail: string;

  beforeAll(async () => {
    await ensureSeeded();
    const adminUser = await registerTestUser('AdminFeedback Admin');
    adminEmail = adminUser.email;
    await prisma.user.update({ where: { id: adminUser.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: 'password1234' });
    adminAccessToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  });

  afterAll(async () => {
    await cleanupTestUser(adminEmail);
  });

  it('non-admin gets 403 on both admin feedback routes', async () => {
    const owner = await registerTestUser('AdminFeedback NonAdmin Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'AdminFeedback NonAdmin Workspace');

    const list = await request(app).get('/api/v1/admin/feedback').set('Authorization', `Bearer ${ws.accessToken}`);
    expect(list.status).toBe(403);

    const update = await request(app)
      .patch('/api/v1/admin/feedback/00000000-0000-4000-8000-000000000001/status')
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ status: 'RESOLVED' });
    expect(update.status).toBe(403);

    await cleanupTestUser(owner.email);
  });

  it('a real admin sees feedback across multiple workspaces — the real point of this cross-tenant surface', async () => {
    const ownerA = await registerTestUser('AdminFeedback Tenant A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'AdminFeedback Tenant A Workspace');
    const submitA = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${wsA.accessToken}`)
      .send({ type: 'BUG', message: 'Tenant A: export button does nothing.' });

    const ownerB = await registerTestUser('AdminFeedback Tenant B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'AdminFeedback Tenant B Workspace');
    const submitB = await request(app)
      .post(`/api/v1/workspaces/${wsB.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ type: 'IDEA', message: 'Tenant B: please add dark mode.' });

    const res = await request(app).get('/api/v1/admin/feedback').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    const body = res.body as { data: { items: FeedbackData[]; nextCursor: string | null } };
    const ids = body.data.items.map((i) => i.id);
    expect(ids).toContain((submitA.body as { data: FeedbackData }).data.id);
    expect(ids).toContain((submitB.body as { data: FeedbackData }).data.id);

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('admin status update writes a real audited transition; a forged/nonexistent feedbackId is a real 404', async () => {
    const owner = await registerTestUser('AdminFeedback Update Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'AdminFeedback Update Workspace');
    const submit = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ type: 'QUESTION', message: 'How do I cancel my subscription?' });
    const feedbackId = (submit.body as { data: FeedbackData }).data.id;

    const update = await request(app)
      .patch(`/api/v1/admin/feedback/${feedbackId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'RESOLVED' });
    expect(update.status).toBe(200);
    expect((update.body as { data: FeedbackData }).data.status).toBe('RESOLVED');

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'Feedback', entityId: feedbackId, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.workspaceId).toBe(ws.workspaceId); // resolved server-side from the real feedback row, never client-suppliable
    expect((audit?.previousValue as { status?: string } | null)?.status).toBe('OPEN');
    expect((audit?.newValue as { status?: string } | null)?.status).toBe('RESOLVED');

    const invalidStatus = await request(app)
      .patch(`/api/v1/admin/feedback/${feedbackId}/status`)
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'NOT_A_REAL_STATUS' });
    expect(invalidStatus.status).toBe(422);

    const forged = await request(app)
      .patch('/api/v1/admin/feedback/00000000-0000-4000-8000-000000000099/status')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ status: 'RESOLVED' });
    expect(forged.status).toBe(404);

    await cleanupTestUser(owner.email);
  });

  it('lists filtered by status and type, both server-validated against the real enum', async () => {
    const owner = await registerTestUser('AdminFeedback Filter Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'AdminFeedback Filter Workspace');
    await request(app).post(`/api/v1/workspaces/${ws.workspaceId}/feedback`).set('Authorization', `Bearer ${ws.accessToken}`).send({ type: 'IDEA', message: 'A real idea for filtering.' });

    const filtered = await request(app).get('/api/v1/admin/feedback?type=IDEA&status=OPEN').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(filtered.status).toBe(200);
    const items = (filtered.body as { data: { items: FeedbackData[] } }).data.items;
    expect(items.length).toBeGreaterThan(0);

    // An invalid filter value is silently ignored (not a 500/422) — same
    // permissive-query-param convention as the rest of the admin search
    // surface (searchWorkspacesHandler, searchUsersHandler).
    const junkFilter = await request(app).get('/api/v1/admin/feedback?type=NOT_REAL').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(junkFilter.status).toBe(200);

    await cleanupTestUser(owner.email);
  });
});
