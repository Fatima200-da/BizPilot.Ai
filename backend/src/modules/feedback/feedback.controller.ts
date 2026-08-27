import type { Request, Response } from 'express';
import type { FeedbackStatus, FeedbackType } from '@prisma/client';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import * as feedbackService from './feedback.service';

const VALID_TYPES: readonly FeedbackType[] = ['BUG', 'IDEA', 'QUESTION', 'GENERAL'];
const VALID_STATUSES: readonly FeedbackStatus[] = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'];

export const submitFeedbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { type?: unknown; message?: unknown; context?: unknown };

  if (typeof body.type !== 'string' || !VALID_TYPES.includes(body.type as FeedbackType)) {
    throw new ValidationError([{ field: 'type', code: 'INVALID', message: `type must be one of ${VALID_TYPES.join(', ')}.` }]);
  }
  if (typeof body.message !== 'string') {
    throw new ValidationError([{ field: 'message', code: 'REQUIRED', message: 'message is required.' }]);
  }

  const feedback = await feedbackService.submitFeedback({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    type: body.type as FeedbackType,
    message: body.message,
    context: typeof body.context === 'object' && body.context !== null ? (body.context as Record<string, unknown>) : undefined,
  });
  sendData(res, feedback, 201);
});

export const listWorkspaceFeedbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const items = await feedbackService.listWorkspaceFeedback(auth.workspaceId);
  sendData(res, items);
});

/** Cross-tenant — mounted under /admin (requireSystemAdmin), not workspace-scoped. See feedback.service.ts's listAllFeedback doc comment. */
export const listAllFeedbackHandler = asyncHandler(async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' && VALID_STATUSES.includes(req.query.status as FeedbackStatus) ? (req.query.status as FeedbackStatus) : undefined;
  const type = typeof req.query.type === 'string' && VALID_TYPES.includes(req.query.type as FeedbackType) ? (req.query.type as FeedbackType) : undefined;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const result = await feedbackService.listAllFeedback({ status, type, cursor, limit });
  sendData(res, result);
});

export const updateFeedbackStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { status?: unknown };
  if (typeof body.status !== 'string' || !VALID_STATUSES.includes(body.status as FeedbackStatus)) {
    throw new ValidationError([{ field: 'status', code: 'INVALID', message: `status must be one of ${VALID_STATUSES.join(', ')}.` }]);
  }
  const updated = await feedbackService.updateFeedbackStatus(req.params.id as string, body.status as FeedbackStatus, auth.userId);
  sendData(res, updated);
});
