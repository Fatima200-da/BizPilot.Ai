import type { Feedback, FeedbackStatus, FeedbackType, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';

const MESSAGE_MAX_LENGTH = 4000;

export interface SubmitFeedbackInput {
  workspaceId: string;
  userId: string;
  type: FeedbackType;
  message: string;
  context?: Record<string, unknown>;
}

/** Phase 29 Section 24: minimal customer feedback channel — no attachments, no unnecessary personal data beyond the authenticated actor. */
export async function submitFeedback(input: SubmitFeedbackInput): Promise<Feedback> {
  const message = input.message.trim();
  if (message.length === 0) throw new ValidationError([{ field: 'message', code: 'REQUIRED', message: 'message is required.' }]);
  if (message.length > MESSAGE_MAX_LENGTH) {
    throw new ValidationError([{ field: 'message', code: 'TOO_LONG', message: `message must be ${String(MESSAGE_MAX_LENGTH)} characters or fewer.` }]);
  }

  return prisma.feedback.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      message,
      context: input.context as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function listWorkspaceFeedback(workspaceId: string): Promise<Feedback[]> {
  return prisma.feedback.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
}

export interface AdminFeedbackFilter {
  status?: FeedbackStatus;
  type?: FeedbackType;
  cursor?: string;
  limit?: number;
}

/** Admin-wide feedback listing — deliberately not workspace-scoped (an admin triaging feedback needs the cross-tenant view; every other read in this codebase that's cross-tenant already lives behind `requireSystemAdmin`, same guard reused here). */
export async function listAllFeedback(filter: AdminFeedbackFilter): Promise<{ items: Feedback[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
  const items = await prisma.feedback.findMany({
    where: { status: filter.status, type: filter.type },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    include: { user: { select: { id: true, email: true, fullName: true } }, workspace: { select: { id: true, name: true } } },
  });
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  return { items: page, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
}

export async function updateFeedbackStatus(feedbackId: string, status: FeedbackStatus, adminUserId: string): Promise<Feedback> {
  const existing = await prisma.feedback.findUnique({ where: { id: feedbackId } });
  if (!existing) throw new NotFoundError('Feedback not found.');

  const updated = await prisma.feedback.update({ where: { id: feedbackId }, data: { status } });

  await prisma.auditLog.create({
    data: {
      workspaceId: existing.workspaceId,
      actorUserId: adminUserId,
      action: 'UPDATE', // matches the existing generic-action convention (e.g. adjustWorkspaceCredits uses BILLING_CHANGE, not a per-feature enum value)
      entityType: 'Feedback',
      entityId: feedbackId,
      previousValue: { status: existing.status },
      newValue: { status: updated.status },
    },
  });

  return updated;
}
