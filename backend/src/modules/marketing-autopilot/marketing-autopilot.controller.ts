import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { startWorkflow } from '../workflows/workflow-engine.service';
import type { StartMarketingAutopilotInput } from './marketing-autopilot.schemas';

export const startHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as StartMarketingAutopilotInput;
  const instance = await startWorkflow({
    workspaceId: auth.workspaceId,
    workflowDefinitionKey: 'marketing-autopilot',
    businessProfileId: body.businessProfileId,
    triggeredByUserId: auth.userId,
    input: { objective: body.objective, platforms: body.platforms },
    idempotencyKey: body.idempotencyKey,
  });
  res.locals.workflowInstanceId = instance.id;
  sendData(res, instance, 201);
});
