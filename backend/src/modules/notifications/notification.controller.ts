import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import * as notificationService from './notification.service';

export const listNotificationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const result = await notificationService.listNotifications({ recipientUserId: auth.userId, workspaceId, cursor, limit });
  sendData(res, result);
});

export const unreadCountHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const count = await notificationService.getUnreadCount(auth.userId, workspaceId);
  sendData(res, { count });
});

export const markReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const notification = await notificationService.markRead(req.params.id as string, auth.userId);
  sendData(res, notification);
});

export const markAllReadHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : undefined;
  const result = await notificationService.markAllRead(auth.userId, workspaceId);
  sendData(res, result);
});
