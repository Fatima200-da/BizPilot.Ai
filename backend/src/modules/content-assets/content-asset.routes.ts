import { Router } from 'express';
import { authenticate, requireWorkspaceContext } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody, validateQuery } from '../../common/middlewares/validate';
import { listContentAssetsQuerySchema, updateContentAssetSchema } from './content-asset.validation';
import { getHandler, listHandler, updateHandler } from './content-asset.controller';

export const contentAssetRouter = Router();

contentAssetRouter.use(authenticate, requireWorkspaceContext);
contentAssetRouter.get('/', validateQuery(listContentAssetsQuerySchema), listHandler);
contentAssetRouter.get('/:id', getHandler);
contentAssetRouter.patch('/:id', authorize('workflow.approve'), validateBody(updateContentAssetSchema), updateHandler);
