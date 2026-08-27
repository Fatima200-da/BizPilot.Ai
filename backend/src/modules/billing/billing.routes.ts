import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody } from '../../common/middlewares/validate';
import { changePlanSchema, cancelSubscriptionSchema } from './billing.validation';
import {
  listPlansHandler,
  getSubscriptionHandler,
  upgradeSubscriptionHandler,
  downgradeSubscriptionHandler,
  cancelSubscriptionHandler,
  reactivateSubscriptionHandler,
  getUsageHandler,
  listInvoicesHandler,
} from './billing.controller';

/** Mounted at top-level /plans (apiRouter) — a read-only catalog, not workspace-scoped. */
export const planRouter = Router();
planRouter.use(authenticate);
planRouter.get('/', listPlansHandler);

/** Mounted at /workspaces/:workspaceId/subscription (workspaceScoped). Section 9: OWNER-only (billing.manage) for every mutating action; any workspace member can read. */
export const subscriptionRouter = Router();
subscriptionRouter.get('/', getSubscriptionHandler);
subscriptionRouter.post('/upgrade', authorize('billing.manage'), validateBody(changePlanSchema), upgradeSubscriptionHandler);
subscriptionRouter.post('/downgrade', authorize('billing.manage'), validateBody(changePlanSchema), downgradeSubscriptionHandler);
subscriptionRouter.post('/cancel', authorize('billing.manage'), validateBody(cancelSubscriptionSchema), cancelSubscriptionHandler);
subscriptionRouter.post('/reactivate', authorize('billing.manage'), reactivateSubscriptionHandler);

/** Mounted at /workspaces/:workspaceId/usage (workspaceScoped). */
export const usageRouter = Router();
usageRouter.get('/', getUsageHandler);

/** Mounted at /workspaces/:workspaceId/billing (workspaceScoped). */
export const billingRouter = Router();
billingRouter.get('/invoices', authorize('billing.manage'), listInvoicesHandler);
