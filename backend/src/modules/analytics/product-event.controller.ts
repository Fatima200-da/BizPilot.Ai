import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import { trackEvent, listRecentWorkspaceActivity, CLIENT_TRACKABLE_EVENTS, type ProductEventName } from './product-event.service';

/**
 * The client can only ever report a name from `CLIENT_TRACKABLE_EVENTS` —
 * every business-meaningful event (signup completed, first AI action,
 * workflow completed, subscription changed, ...) is emitted server-side at
 * its real call site and can never be spoofed by a client POST here.
 */
export const trackClientEventHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { eventName?: unknown; entityType?: unknown; entityId?: unknown; properties?: unknown };

  if (typeof body.eventName !== 'string' || !CLIENT_TRACKABLE_EVENTS.has(body.eventName)) {
    throw new ValidationError([{ field: 'eventName', code: 'INVALID', message: 'eventName must be one of the client-trackable event names.' }]);
  }

  await trackEvent({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    eventName: body.eventName as ProductEventName,
    entityType: typeof body.entityType === 'string' ? body.entityType : undefined,
    entityId: typeof body.entityId === 'string' ? body.entityId : undefined,
    properties: typeof body.properties === 'object' && body.properties !== null ? (body.properties as Record<string, unknown>) : undefined,
  });

  sendData(res, { tracked: true });
});

export const listWorkspaceActivityHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const items = await listRecentWorkspaceActivity(auth.workspaceId);
  sendData(res, items);
});
