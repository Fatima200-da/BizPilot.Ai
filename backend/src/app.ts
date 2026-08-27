import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { env } from './config/env';
import { requestContext } from './common/middlewares/request-context';
import { requestLogger } from './common/middlewares/request-logger';
import { requestTimeout } from './common/middlewares/request-timeout';
import { generalRateLimit } from './common/middlewares/rate-limit';
import { errorHandler, notFoundHandler } from './common/middlewares/error-handler';
import { authenticate, enforceWorkspacePathMatch, requireWorkspaceContext } from './common/middlewares/auth';
import { liveHandler, readyHandler, metricsHandler } from './modules/health/health.controller';
import { authRouter } from './modules/auth/auth.routes';
import { workspaceRouter } from './modules/workspaces/workspace.routes';
import { businessProfileRouter } from './modules/business-profiles/business-profile.routes';
import { crmRouter } from './modules/crm/crm.routes';
import { workflowRouter } from './modules/workflows/workflow.routes';
import { marketingAutopilotRouter } from './modules/marketing-autopilot/marketing-autopilot.routes';
import { contentAssetRouter } from './modules/content-assets/content-asset.routes';
import { businessAnalyzerRouter } from './modules/business-analyzer/business-analyzer.routes';
import { memberRouter, workspaceInvitationRouter, invitationActionRouter } from './modules/team/team.routes';
import { planRouter, subscriptionRouter, usageRouter, billingRouter } from './modules/billing/billing.routes';
import { notificationRouter } from './modules/notifications/notification.routes';
import { adminRouter } from './modules/admin/admin.routes';
import { onboardingRouter, onboardingStatusRouter } from './modules/onboarding/onboarding.routes';
import { scheduledWorkflowRouter } from './modules/scheduler/scheduled-workflow.routes';
import { webhookRouter } from './modules/billing/webhook.routes';
import { productEventRouter } from './modules/analytics/product-event.routes';
import { feedbackRouter } from './modules/feedback/feedback.routes';
import { dataExportRouter } from './modules/data-export/data-export.routes';

/**
 * API_CONTRACT.md Section 1.3's Middleware Pipeline, implemented in order.
 * Authentication is applied per-router rather than as one global gate
 * (public routes — /auth/register, /auth/login — must bypass it), which is
 * functionally equivalent to that section's flow for this MVP's route set.
 * CSRF (step 7) is not implemented: Bearer-only auth is structurally immune
 * to CSRF per AUTH_ARCHITECTURE.md Section 5.3's own reasoning, and cookie
 * auth is not implemented in this slice (see completion report). The
 * generic header-based Idempotency-Key middleware (Section 2.17) is not
 * implemented globally — only the Marketing Autopilot's body-level
 * `idempotencyKey` exists (Section 14's specific requirement) — also
 * flagged honestly in the completion report rather than silently assumed.
 */
export function createApp(): Express {
  const app = express();

  // Phase 34 Track I: a real `curl` against the running server found
  // `X-Powered-By: Express` present despite helmet() being applied —
  // helmet's hidePoweredBy middleware calls `res.removeHeader` early in the
  // chain, but Express's own `res.send()`/`res.json()` re-adds the header
  // later (it checks the `x-powered-by` app SETTING, not just the
  // response's current header state) — a real, known ordering gotcha, not
  // a helmet bug. `app.disable(...)` changes the setting Express itself
  // checks, which is the actually-effective fix.
  app.disable('x-powered-by');

  // Phase 34 Track A: must be set before any middleware that reads req.ip
  // (rate-limit.ts's keyGenerators, auth.controller.ts's login/register
  // audit fields) — see env.ts's TRUST_PROXY doc comment for the real
  // defect this closes.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestContext); // 1. Request-ID / trace context
  app.use(requestLogger); // structured request logging (Phase 16 Section 17)
  app.use(requestTimeout(env.REQUEST_TIMEOUT_MS)); // Phase 19: hard ceiling on request duration
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true })); // 2. CORS
  app.use(helmet()); // 3. Security headers
  app.use(compression()); // Phase 19: gzip response bodies

  // Phase 28 Track B: mounted BEFORE the global JSON body parser — Stripe's
  // signature is computed over the exact raw request bytes, so this route
  // owns its own `express.raw()` middleware (webhook.routes.ts) instead of
  // ever going through express.json() at all. See that file's doc comment.
  app.use(`${env.API_PREFIX}/webhooks`, webhookRouter);

  app.use(express.json({ limit: '2mb' })); // 4. Body parsing + size limit
  app.use(generalRateLimit); // 6. Rate limiting (per-identity via authenticate having already run on protected routers, or per-IP)

  app.get('/health/live', liveHandler);
  app.get('/health/ready', (req, res) => void readyHandler(req, res));
  app.get('/metrics', metricsHandler);

  const apiRouter = express.Router();

  apiRouter.use('/auth', authRouter);
  apiRouter.use('/workspaces', workspaceRouter);
  // Phase 25 Section 10: NOT workspace-scoped — the accepting/rejecting
  // user may not yet have a membership in the target workspace at all
  // (see team.controller.ts's doc comment on acceptInvitationHandler).
  apiRouter.use('/invitations', invitationActionRouter);
  apiRouter.use('/plans', planRouter);
  apiRouter.use('/notifications', notificationRouter);
  apiRouter.use('/admin', adminRouter);
  apiRouter.use('/onboarding', onboardingStatusRouter);

  // Every workspace-scoped resource is mounted under /workspaces/:workspaceId/...
  // per API_CONTRACT.md Section 1.5: the path param is validated against the
  // token's workspaceId claim (404, never 403, on mismatch — anti-enumeration).
  const workspaceScoped = express.Router({ mergeParams: true });
  workspaceScoped.use(authenticate, requireWorkspaceContext, enforceWorkspacePathMatch);
  workspaceScoped.use('/business-profiles', businessProfileRouter);
  workspaceScoped.use('/crm', crmRouter);
  workspaceScoped.use('/workflows/marketing-autopilot', marketingAutopilotRouter);
  workspaceScoped.use('/workflow-instances', workflowRouter);
  workspaceScoped.use('/content-assets', contentAssetRouter);
  workspaceScoped.use('/business-analyzer', businessAnalyzerRouter);
  workspaceScoped.use('/members', memberRouter);
  workspaceScoped.use('/invitations', workspaceInvitationRouter);
  workspaceScoped.use('/subscription', subscriptionRouter);
  workspaceScoped.use('/usage', usageRouter);
  workspaceScoped.use('/billing', billingRouter);
  workspaceScoped.use('/onboarding', onboardingRouter);
  workspaceScoped.use('/scheduled-workflows', scheduledWorkflowRouter);
  workspaceScoped.use('/events', productEventRouter);
  workspaceScoped.use('/feedback', feedbackRouter);
  workspaceScoped.use('/export', dataExportRouter);
  apiRouter.use('/workspaces/:workspaceId', workspaceScoped);

  app.use(env.API_PREFIX, apiRouter);

  app.use(notFoundHandler); // unmatched routes
  app.use(errorHandler); // 11. Error handler — must be registered last

  return app;
}
