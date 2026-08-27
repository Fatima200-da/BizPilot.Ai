import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth';
import { notificationRateLimit } from '../../common/middlewares/rate-limit';
import { listNotificationsHandler, unreadCountHandler, markReadHandler, markAllReadHandler } from './notification.controller';

/**
 * Mounted at top-level /notifications (apiRouter), NOT workspace-scoped —
 * a user's notification feed spans every workspace they belong to (an
 * INVITATION_RECEIVED notification exists before they have a membership in
 * that workspace at all). `workspaceId` is an optional filter, never a
 * path-authorization boundary; the real scope is always `recipientUserId`
 * from the authenticated session.
 */
export const notificationRouter = Router();
notificationRouter.use(authenticate, notificationRateLimit);
notificationRouter.get('/', listNotificationsHandler);
notificationRouter.get('/unread-count', unreadCountHandler);
notificationRouter.patch('/:id/read', markReadHandler);
notificationRouter.patch('/read-all', markAllReadHandler);
