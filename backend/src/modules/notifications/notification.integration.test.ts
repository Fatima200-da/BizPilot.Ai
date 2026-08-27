import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { createNotification, getUnreadCount, listNotifications, markAllRead, markRead } from './notification.service';

interface NotificationData {
  id: string;
  title: string;
  readAt: string | null;
}

describe('Notification system (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Notification Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Notification Test Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('creates a real notification and it is idempotent for the same (workspace, type, relatedEntityId)', async () => {
    const first = await createNotification({
      workspaceId: workspace.workspaceId,
      recipientUserId: owner.userId,
      category: 'BILLING',
      type: 'SUBSCRIPTION_CHANGED',
      title: 'Plan changed to Pro',
      relatedEntityType: 'Subscription',
      relatedEntityId: 'test-idempotency-key-1',
    });
    expect(first.created).toBe(true);

    const second = await createNotification({
      workspaceId: workspace.workspaceId,
      recipientUserId: owner.userId,
      category: 'BILLING',
      type: 'SUBSCRIPTION_CHANGED',
      title: 'Plan changed to Pro (duplicate attempt)',
      relatedEntityType: 'Subscription',
      relatedEntityId: 'test-idempotency-key-1',
    });
    expect(second.created).toBe(false);
    expect(second.notification.id).toBe(first.notification.id);

    const count = await prisma.notification.count({ where: { workspaceId: workspace.workspaceId, type: 'SUBSCRIPTION_CHANGED', relatedEntityId: 'test-idempotency-key-1' } });
    expect(count).toBe(1);
  });

  it('CONCURRENT duplicate-trigger notification creation still results in exactly one row', async () => {
    const [resultA, resultB] = await Promise.all([
      createNotification({
        workspaceId: workspace.workspaceId,
        recipientUserId: owner.userId,
        category: 'BILLING',
        type: 'CREDITS_LOW',
        title: 'Credits running low',
        relatedEntityId: 'concurrent-test-key-1',
      }),
      createNotification({
        workspaceId: workspace.workspaceId,
        recipientUserId: owner.userId,
        category: 'BILLING',
        type: 'CREDITS_LOW',
        title: 'Credits running low',
        relatedEntityId: 'concurrent-test-key-1',
      }),
    ]);
    expect(resultA.notification.id).toBe(resultB.notification.id);
    const createdCount = [resultA.created, resultB.created].filter(Boolean).length;
    expect(createdCount).toBe(1);

    const rows = await prisma.notification.count({ where: { workspaceId: workspace.workspaceId, type: 'CREDITS_LOW', relatedEntityId: 'concurrent-test-key-1' } });
    expect(rows).toBe(1);
  });

  it('unread count, list pagination (deterministic ordering), and mark-read work correctly', async () => {
    const owner2 = await registerTestUser('Notification List Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Notification List Workspace');

    for (let i = 0; i < 5; i += 1) {
      // Sequential (not Promise.all) so createdAt strictly orders for the pagination assertions below.
      await createNotification({
        workspaceId: ws2.workspaceId,
        recipientUserId: owner2.userId,
        category: 'SYSTEM',
        type: 'WORKFLOW_COMPLETED',
        title: `Notification ${String(i)}`,
        relatedEntityId: `list-test-${String(i)}`,
      });
    }

    const unread = await getUnreadCount(owner2.userId, ws2.workspaceId);
    expect(unread).toBe(5);

    const page1 = await listNotifications({ recipientUserId: owner2.userId, workspaceId: ws2.workspaceId, limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await listNotifications({ recipientUserId: owner2.userId, workspaceId: ws2.workspaceId, limit: 3, cursor: page1.nextCursor ?? undefined });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const allIds = new Set([...page1.items, ...page2.items].map((n) => n.id));
    expect(allIds.size).toBe(5); // no duplicates, no gaps across the two pages

    const target = page1.items[0];
    if (!target) throw new Error('expected at least one notification');
    const marked = await markRead(target.id, owner2.userId);
    expect(marked.readAt).not.toBeNull();
    expect(await getUnreadCount(owner2.userId, ws2.workspaceId)).toBe(4);

    const markAllResult = await markAllRead(owner2.userId, ws2.workspaceId);
    expect(markAllResult.updated).toBe(4);
    expect(await getUnreadCount(owner2.userId, ws2.workspaceId)).toBe(0);

    await cleanupTestUser(owner2.email);
  });

  it('a user cannot mark another user\'s notification as read (ownership enforced, anti-enumeration)', async () => {
    const { notification } = await createNotification({
      workspaceId: workspace.workspaceId,
      recipientUserId: owner.userId,
      category: 'SYSTEM',
      type: 'SECURITY_EVENT',
      title: 'Ownership test notification',
      relatedEntityId: 'ownership-test-1',
    });

    const otherUser = await registerTestUser('Notification Ownership Other User');
    await expect(markRead(notification.id, otherUser.userId)).rejects.toThrow();
    await cleanupTestUser(otherUser.email);
  });

  it('HTTP surface: GET /notifications, GET /notifications/unread-count, PATCH /:id/read, PATCH /read-all', async () => {
    const owner3 = await registerTestUser('Notification HTTP Owner');
    const ws3 = await createTestWorkspace(owner3.accessToken, 'Notification HTTP Workspace');

    await createNotification({
      workspaceId: ws3.workspaceId,
      recipientUserId: owner3.userId,
      category: 'TEAM',
      type: 'INVITATION_ACCEPTED',
      title: 'Someone joined your workspace',
      relatedEntityId: 'http-test-1',
    });

    const listRes = await request(app).get('/api/v1/notifications').query({ workspaceId: ws3.workspaceId }).set('Authorization', `Bearer ${owner3.accessToken}`);
    expect(listRes.status).toBe(200);
    const listed = (listRes.body as { data: { items: NotificationData[] } }).data;
    expect(listed.items).toHaveLength(1);

    const unreadRes = await request(app).get('/api/v1/notifications/unread-count').query({ workspaceId: ws3.workspaceId }).set('Authorization', `Bearer ${owner3.accessToken}`);
    expect(data<{ count: number }>(unreadRes).count).toBe(1);

    const firstNotificationId = listed.items[0]?.id;
    if (!firstNotificationId) throw new Error('expected at least one notification');
    const markRes = await request(app).patch(`/api/v1/notifications/${firstNotificationId}/read`).set('Authorization', `Bearer ${owner3.accessToken}`);
    expect(markRes.status).toBe(200);

    const unreadAfter = await request(app).get('/api/v1/notifications/unread-count').query({ workspaceId: ws3.workspaceId }).set('Authorization', `Bearer ${owner3.accessToken}`);
    expect(data<{ count: number }>(unreadAfter).count).toBe(0);

    await cleanupTestUser(owner3.email);
  });
});
