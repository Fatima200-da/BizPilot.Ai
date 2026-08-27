import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import * as engine from './workflow-engine.service';

export const getInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await engine.getInstance(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

/** Phase 19: "resume my existing plan" — returns the most recent instance of the given workflow definition, or null (never 404) if none exists yet. */
export const getLatestInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const key = req.query.workflowDefinitionKey;
  if (typeof key !== 'string' || key.length === 0) {
    throw new ValidationError([{ field: 'workflowDefinitionKey', code: 'REQUIRED', message: 'workflowDefinitionKey query parameter is required.' }]);
  }
  const result = await engine.getLatestInstance(requireAuth(req).workspaceId, key);
  sendData(res, result);
});

export const approveInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await engine.approveInstance(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const rejectInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await engine.rejectInstance(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const retryInstanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { reason?: unknown };
  if (typeof body.reason !== 'string' || body.reason.trim().length === 0) {
    throw new ValidationError([{ field: 'reason', code: 'REQUIRED', message: 'reason is required.' }]);
  }
  const result = await engine.retryInstance(auth.workspaceId, req.params.id as string, auth.userId, body.reason);
  sendData(res, result);
});
