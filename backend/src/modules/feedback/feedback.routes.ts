import { Router } from 'express';
import { feedbackRateLimit } from '../../common/middlewares/rate-limit';
import { submitFeedbackHandler, listWorkspaceFeedbackHandler } from './feedback.controller';

/** Mounted at /workspaces/:workspaceId/feedback (workspaceScoped — see app.ts). Cross-tenant admin listing/status-update lives on admin.routes.ts instead (same pattern as every other admin cross-tenant read in this codebase). */
export const feedbackRouter = Router();
feedbackRouter.get('/', listWorkspaceFeedbackHandler);
feedbackRouter.post('/', feedbackRateLimit, submitFeedbackHandler);
