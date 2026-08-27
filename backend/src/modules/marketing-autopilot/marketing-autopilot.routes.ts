import { Router } from 'express';
import { authenticate, requireWorkspaceContext } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody } from '../../common/middlewares/validate';
import { workflowExecutionRateLimit } from '../../common/middlewares/rate-limit';
import { startMarketingAutopilotSchema } from './marketing-autopilot.schemas';
import { startHandler } from './marketing-autopilot.controller';
import './marketing-autopilot.steps'; // side effect: registers step handlers into the Workflow Engine's registry

export const marketingAutopilotRouter = Router();

marketingAutopilotRouter.use(authenticate, requireWorkspaceContext);
marketingAutopilotRouter.post(
  '/',
  authorize('workflow.execute'),
  workflowExecutionRateLimit, // Phase 19: cost guardrail — see rate-limit.ts's doc comment
  validateBody(startMarketingAutopilotSchema),
  startHandler
);
