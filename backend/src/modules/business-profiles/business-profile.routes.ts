import { Router } from 'express';
import { authenticate, requireWorkspaceContext } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody } from '../../common/middlewares/validate';
import { createBusinessProfileSchema, updateBusinessProfileSchema } from './business-profile.validation';
import { createHandler, getHandler, listHandler, updateHandler } from './business-profile.controller';

export const businessProfileRouter = Router();

businessProfileRouter.use(authenticate, requireWorkspaceContext);
businessProfileRouter.post('/', authorize('business_profile.manage'), validateBody(createBusinessProfileSchema), createHandler);
businessProfileRouter.get('/', listHandler);
businessProfileRouter.get('/:id', getHandler);
businessProfileRouter.patch('/:id', authorize('business_profile.manage'), validateBody(updateBusinessProfileSchema), updateHandler);
