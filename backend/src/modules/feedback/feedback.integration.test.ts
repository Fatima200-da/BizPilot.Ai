import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser, data } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

interface FeedbackData {
  id: string;
  type: string;
  message: string;
  status: string;
}

/** Phase 29 Section 24: the minimal customer feedback channel. */
describe('Feedback (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('a real feedback submission is persisted with OPEN status and the real authenticated actor', async () => {
    const user = await registerTestUser('Feedback Submit User');
    const ws = await createTestWorkspace(user.accessToken, 'Feedback Submit Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ type: 'BUG', message: 'The dashboard chart is showing the wrong currency symbol.' });

    expect(res.status).toBe(201);
    const body = data<FeedbackData>(res);
    expect(body.status).toBe('OPEN');
    expect(body.type).toBe('BUG');

    const stored = await prisma.feedback.findUnique({ where: { id: body.id } });
    expect(stored?.workspaceId).toBe(ws.workspaceId);
    expect(stored?.userId).toBe(user.userId);

    await cleanupTestUser(user.email);
  });

  it('rejects an invalid type and an empty message', async () => {
    const user = await registerTestUser('Feedback Validation User');
    const ws = await createTestWorkspace(user.accessToken, 'Feedback Validation Workspace');

    const badType = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ type: 'NOT_A_REAL_TYPE', message: 'hello' });
    expect(badType.status).toBe(422);

    const emptyMessage = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ type: 'IDEA', message: '   ' });
    expect(emptyMessage.status).toBe(422);

    await cleanupTestUser(user.email);
  });

  it('lists only the caller\'s own workspace feedback', async () => {
    const user = await registerTestUser('Feedback List User');
    const ws = await createTestWorkspace(user.accessToken, 'Feedback List Workspace');
    await request(app).post(`/api/v1/workspaces/${ws.workspaceId}/feedback`).set('Authorization', `Bearer ${ws.accessToken}`).send({ type: 'GENERAL', message: 'Great product so far.' });

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/feedback`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(200);
    const body = data<FeedbackData[]>(res);
    expect(body).toHaveLength(1);

    await cleanupTestUser(user.email);
  });

  it('cross-tenant feedback submission and listing are both a real 404, never a cross-tenant write or leak', async () => {
    const ownerA = await registerTestUser('Feedback Tenant A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Feedback Tenant A Workspace');
    await request(app).post(`/api/v1/workspaces/${wsA.workspaceId}/feedback`).set('Authorization', `Bearer ${wsA.accessToken}`).send({ type: 'QUESTION', message: 'How do I invite my team?' });

    const ownerB = await registerTestUser('Feedback Tenant B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Feedback Tenant B Workspace');

    const crossSubmit = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/feedback`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ type: 'BUG', message: 'forged submission attempt' });
    expect(crossSubmit.status).toBe(404);

    const crossList = await request(app).get(`/api/v1/workspaces/${wsA.workspaceId}/feedback`).set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(crossList.status).toBe(404);

    const realCount = await prisma.feedback.count({ where: { workspaceId: wsA.workspaceId } });
    expect(realCount).toBe(1); // only the legitimate submission, the forged cross-tenant attempt never landed

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });
});
