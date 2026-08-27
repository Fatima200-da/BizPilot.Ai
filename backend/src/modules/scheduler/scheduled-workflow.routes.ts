import { Router } from 'express';
import { createScheduledWorkflowHandler, listScheduledWorkflowsHandler, setScheduledWorkflowEnabledHandler } from './scheduled-workflow.controller';

/** Mounted at /workspaces/:workspaceId/scheduled-workflows (workspaceScoped — see app.ts), same as onboarding.routes.ts. */
export const scheduledWorkflowRouter = Router();
scheduledWorkflowRouter.post('/', createScheduledWorkflowHandler);
scheduledWorkflowRouter.get('/', listScheduledWorkflowsHandler);
scheduledWorkflowRouter.patch('/:id/enabled', setScheduledWorkflowEnabledHandler);
