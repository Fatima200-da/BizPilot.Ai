import type { Notification, NotificationCategory, NotificationType } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../../common/errors/app-error';

/**
 * Phase 26 Section 5: production notification architecture. Idempotent
 * creation is enforced by a real Postgres unique constraint
 * (`workspaceId, type, relatedEntityId` — schema.prisma), not an app-level
 * check-then-insert race; concurrent duplicate-trigger attempts (e.g. two
 * requests racing to create the same CREDITS_LOW alert) both call this
 * function and the loser's unique-violation is treated as "already
 * exists," never surfaced as an error.
 */

export interface CreateNotificationInput {
  workspaceId?: string;
  recipientUserId: string;
  category: NotificationCategory;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

export async function createNotification(input: CreateNotificationInput): Promise<{ notification: Notification; created: boolean }> {
  try {
    const notification = await prisma.notification.create({
      data: {
        workspaceId: input.workspaceId,
        recipientUserId: input.recipientUserId,
        category: input.category,
        type: input.type,
        channel: 'IN_APP',
        title: input.title,
        body: input.body,
        linkUrl: input.linkUrl,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        sentAt: new Date(),
      },
    });
    return { notification, created: true };
  } catch (err) {
    const isUniqueViolation = err instanceof Error && 'code' in err && ((err as { code?: string }).code === 'P2002' || (err as { code?: string }).code === '23505');
    if (isUniqueViolation && input.workspaceId) {
      // `findFirst` (not `findUniqueOrThrow`) because Prisma's generated
      // compound-unique-input type does not accept `null` for the nullable
      // `relatedEntityId` member even though the underlying column and
      // index both do — a `findFirst` with plain equality conditions has
      // no such restriction and matches the same real unique row.
      const existing = await prisma.notification.findFirst({
        where: { workspaceId: input.workspaceId, type: input.type, relatedEntityId: input.relatedEntityId ?? null },
      });
      if (existing) return { notification: existing, created: false };
    }
    throw err;
  }
}

export interface ListNotificationsParams {
  recipientUserId: string;
  workspaceId?: string;
  cursor?: string;
  limit?: number;
}

export interface ListNotificationsResult {
  items: Notification[];
  nextCursor: string | null;
}

/** Deterministic ordering: createdAt desc, id desc as a tiebreaker for same-millisecond rows — never relies on insertion order alone. */
export async function listNotifications(params: ListNotificationsParams): Promise<ListNotificationsResult> {
  const limit = Math.min(params.limit ?? 20, 100);
  const items = await prisma.notification.findMany({
    where: { recipientUserId: params.recipientUserId, workspaceId: params.workspaceId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}

export async function getUnreadCount(recipientUserId: string, workspaceId?: string): Promise<number> {
  return prisma.notification.count({ where: { recipientUserId, workspaceId, readAt: null } });
}

export async function markRead(notificationId: string, recipientUserId: string): Promise<Notification> {
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, recipientUserId } });
  if (!notification) throw new NotFoundError('Notification not found.');
  if (notification.readAt) return notification;
  return prisma.notification.update({ where: { id: notification.id }, data: { readAt: new Date() } });
}

export async function markAllRead(recipientUserId: string, workspaceId?: string): Promise<{ updated: number }> {
  const result = await prisma.notification.updateMany({
    where: { recipientUserId, workspaceId, readAt: null },
    data: { readAt: new Date() },
  });
  return { updated: result.count };
}
