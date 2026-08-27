import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth';
import { getOnboardingHandler, advanceOnboardingHandler, getActivationHandler, skipOnboardingHandler, getUserOnboardingStatusHandler } from './onboarding.controller';

/** Mounted at /workspaces/:workspaceId/onboarding (workspaceScoped — see app.ts). Readable/advanceable by any workspace member — onboarding is a shared workspace state, not an OWNER-only concern. */
export const onboardingRouter = Router();
onboardingRouter.get('/', getOnboardingHandler);
onboardingRouter.patch('/', advanceOnboardingHandler);
onboardingRouter.get('/activation', getActivationHandler);
onboardingRouter.patch('/skip', skipOnboardingHandler);

/**
 * Phase 27 Section 2: mounted at top-level /onboarding (apiRouter), NOT
 * workspace-scoped — mirrors notification.routes.ts's reasoning. A user
 * with zero workspaces cannot pass any workspaceId path param at all, so
 * "what's my onboarding status" has to be answerable without one; the real
 * scope is always the authenticated user themselves.
 */
export const onboardingStatusRouter = Router();
onboardingStatusRouter.use(authenticate);
onboardingStatusRouter.get('/status', getUserOnboardingStatusHandler);
