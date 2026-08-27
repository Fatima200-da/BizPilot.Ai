import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import * as service from './business-profile.service';
import type { CreateBusinessProfileInput, UpdateBusinessProfileInput } from './business-profile.validation';

export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createBusinessProfile(requireAuth(req).workspaceId, req.body as CreateBusinessProfileInput);
  sendData(res, result, 201);
});

export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.listBusinessProfiles(requireAuth(req).workspaceId);
  sendData(res, result);
});

export const getHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getBusinessProfile(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateBusinessProfile(
    requireAuth(req).workspaceId,
    req.params.id as string,
    req.body as UpdateBusinessProfileInput
  );
  sendData(res, result);
});
