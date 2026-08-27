import { Router } from 'express';
import { authenticate, enforceWorkspacePathMatch } from '../../common/middlewares/auth';
import { validateBody } from '../../common/middlewares/validate';
import { createWorkspaceSchema } from './workspace.validation';
import { createWorkspaceHandler, getWorkspaceHandler, listMyWorkspacesHandler, selectWorkspaceHandler } from './workspace.controller';

export const workspaceRouter = Router();

workspaceRouter.use(authenticate);
workspaceRouter.post('/', validateBody(createWorkspaceSchema), createWorkspaceHandler);
workspaceRouter.get('/', listMyWorkspacesHandler);
// Deliberately NOT gated by enforceWorkspacePathMatch: the whole point of
// this route is minting a workspace-scoped token for a caller whose current
// token has no (or a different) workspace claim yet. Authorization is the
// ACTIVE-membership lookup inside selectWorkspace itself.
workspaceRouter.post('/:workspaceId/select', selectWorkspaceHandler);
workspaceRouter.get('/:workspaceId', enforceWorkspacePathMatch, getWorkspaceHandler);
