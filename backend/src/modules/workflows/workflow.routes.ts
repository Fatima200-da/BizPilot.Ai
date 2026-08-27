import { Router } from 'express';
import { authenticate, requireWorkspaceContext } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { getInstanceHandler, getLatestInstanceHandler, approveInstanceHandler, rejectInstanceHandler, retryInstanceHandler } from './workflow.controller';

export const workflowRouter = Router();

workflowRouter.use(authenticate, requireWorkspaceContext);
// Phase 17: this router is mounted at /workflow-instances in app.ts —
// routes here must NOT repeat "instances" (a real bug found only because
// this route was finally exercised via a real HTTP integration test for
// the first time this phase; see docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md).
// /latest MUST be registered before /:id or Express would match "latest" as an id.
workflowRouter.get('/latest', getLatestInstanceHandler);
workflowRouter.get('/:id', getInstanceHandler);
workflowRouter.post('/:id/approve', authorize('workflow.approve'), approveInstanceHandler);
workflowRouter.post('/:id/reject', authorize('workflow.approve'), rejectInstanceHandler);
workflowRouter.post('/:id/retry', authorize('workflow.approve'), retryInstanceHandler);
