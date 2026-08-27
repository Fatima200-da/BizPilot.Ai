import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import * as scheduledWorkflowService from './scheduled-workflow.service';
import type { ScheduleIntervalUnit } from '@prisma/client';

const VALID_INTERVAL_UNITS: ScheduleIntervalUnit[] = ['MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH'];

export const createScheduledWorkflowHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as {
    workflowDefinitionKey?: string;
    businessProfileId?: string;
    name?: string;
    intervalUnit?: string;
    intervalValue?: number;
    timeOfDay?: string;
    dayOfWeek?: number;
    timezone?: string;
    input?: Record<string, unknown>;
  };

  if (!body.workflowDefinitionKey || !body.name || !body.intervalUnit) {
    throw new ValidationError([{ field: 'body', code: 'REQUIRED', message: 'workflowDefinitionKey, name, and intervalUnit are required.' }]);
  }
  if (!VALID_INTERVAL_UNITS.includes(body.intervalUnit as ScheduleIntervalUnit)) {
    throw new ValidationError([{ field: 'intervalUnit', code: 'INVALID', message: `intervalUnit must be one of: ${VALID_INTERVAL_UNITS.join(', ')}.` }]);
  }

  const created = await scheduledWorkflowService.createScheduledWorkflow({
    workspaceId: auth.workspaceId,
    workflowDefinitionKey: body.workflowDefinitionKey,
    businessProfileId: body.businessProfileId,
    createdByUserId: auth.userId,
    name: body.name,
    intervalUnit: body.intervalUnit as ScheduleIntervalUnit,
    intervalValue: body.intervalValue,
    timeOfDay: body.timeOfDay,
    dayOfWeek: body.dayOfWeek,
    timezone: body.timezone,
    input: body.input,
  });
  sendData(res, created, 201);
});

export const listScheduledWorkflowsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const results = await scheduledWorkflowService.listScheduledWorkflows(auth.workspaceId);
  sendData(res, results);
});

export const setScheduledWorkflowEnabledHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { enabled?: boolean };
  if (typeof body.enabled !== 'boolean') {
    throw new ValidationError([{ field: 'enabled', code: 'REQUIRED', message: 'enabled (boolean) is required.' }]);
  }
  const updated = await scheduledWorkflowService.setScheduledWorkflowEnabled(auth.workspaceId, req.params.id as string, body.enabled);
  sendData(res, updated);
});
