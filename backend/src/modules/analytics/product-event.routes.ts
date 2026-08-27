import { Router } from 'express';
import { productEventRateLimit } from '../../common/middlewares/rate-limit';
import { trackClientEventHandler, listWorkspaceActivityHandler } from './product-event.controller';

/** Mounted at /workspaces/:workspaceId/events (workspaceScoped — see app.ts). */
export const productEventRouter = Router();
productEventRouter.use(productEventRateLimit);
productEventRouter.post('/', trackClientEventHandler);
productEventRouter.get('/activity', listWorkspaceActivityHandler);
