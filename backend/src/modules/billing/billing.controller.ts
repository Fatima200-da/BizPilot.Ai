import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import { prisma } from '../../infrastructure/database/prisma';
import * as planService from './plan.service';
import * as subscriptionService from './subscription.service';
import * as usageService from './usage.service';
import * as invoiceService from './invoice.service';
import type { ChangePlanInput, CancelSubscriptionInput } from './billing.validation';

export const listPlansHandler = asyncHandler(async (_req: Request, res: Response) => {
  const plans = await planService.listActivePlans();
  sendData(res, plans);
});

export const getSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const subscription = await subscriptionService.getCurrentSubscription(auth.workspaceId);
  sendData(res, subscription);
});

async function assertDirection(workspaceId: string, targetPlanKey: string, expected: 'upgrade' | 'downgrade'): Promise<void> {
  const [subscription, targetPlan] = await Promise.all([
    subscriptionService.getCurrentSubscription(workspaceId),
    prisma.subscriptionPlan.findUniqueOrThrow({ where: { key: targetPlanKey } }),
  ]);
  const isUpgrade = targetPlan.sortOrder >= subscription.plan.sortOrder;
  if (expected === 'upgrade' && !isUpgrade) {
    throw new ValidationError([{ field: 'planKey', code: 'INVALID', message: `"${targetPlanKey}" is not an upgrade from the current plan. Use /subscription/downgrade.` }]);
  }
  if (expected === 'downgrade' && isUpgrade && subscription.plan.key !== targetPlan.key) {
    throw new ValidationError([{ field: 'planKey', code: 'INVALID', message: `"${targetPlanKey}" is not a downgrade from the current plan. Use /subscription/upgrade.` }]);
  }
}

export const upgradeSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as ChangePlanInput;
  await assertDirection(auth.workspaceId, body.planKey, 'upgrade');
  const result = await subscriptionService.changePlan(auth.workspaceId, body.planKey, auth.userId);
  const subscription = await subscriptionService.getCurrentSubscription(auth.workspaceId);
  sendData(res, { applied: result.applied, pending: result.pending, reason: result.reason, subscription });
});

export const downgradeSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as ChangePlanInput;
  await assertDirection(auth.workspaceId, body.planKey, 'downgrade');
  const result = await subscriptionService.changePlan(auth.workspaceId, body.planKey, auth.userId);
  const subscription = await subscriptionService.getCurrentSubscription(auth.workspaceId);
  sendData(res, { applied: result.applied, pending: result.pending, reason: result.reason, subscription });
});

export const cancelSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as CancelSubscriptionInput;
  const result = await subscriptionService.cancelSubscription(auth.workspaceId, auth.userId, body.immediate);
  sendData(res, result);
});

export const reactivateSubscriptionHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const result = await subscriptionService.reactivateSubscription(auth.workspaceId, auth.userId);
  sendData(res, result);
});

export const getUsageHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const usage = await usageService.getUsageSummary(auth.workspaceId);
  sendData(res, usage);
});

export const listInvoicesHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const invoices = await invoiceService.listInvoicesForWorkspace(auth.workspaceId);
  sendData(res, invoices);
});
