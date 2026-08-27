import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendCollection, sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import * as service from './content-asset.service';
import type { ListContentAssetsQuery, UpdateContentAssetInput } from './content-asset.validation';

export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = (req as Request & { validatedQuery: ListContentAssetsQuery }).validatedQuery;
  const { data, pagination } = await service.listContentAssets(requireAuth(req).workspaceId, query);
  sendCollection(res, data, pagination);
});

export const getHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getContentAsset(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const result = await service.updateContentAsset(auth.workspaceId, req.params.id as string, auth.userId, req.body as UpdateContentAssetInput);
  sendData(res, result);
});
