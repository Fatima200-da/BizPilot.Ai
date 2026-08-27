import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { ValidationError } from '../../common/errors/app-error';
import * as onboardingService from './onboarding.service';

export const getOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const state = await onboardingService.getOnboardingState(auth.workspaceId);
  sendData(res, state);
});

export const advanceOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { step?: string };
  if (!body.step) throw new ValidationError([{ field: 'step', code: 'REQUIRED', message: 'step is required.' }]);
  const state = await onboardingService.advanceOnboardingStep(auth.workspaceId, body.step as onboardingService.OnboardingStep, auth.userId);
  sendData(res, state);
});

export const getActivationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const activation = await onboardingService.getActivationStatus(auth.workspaceId);
  sendData(res, activation);
});

export const skipOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const state = await onboardingService.skipOnboarding(auth.workspaceId, auth.userId);
  sendData(res, state);
});

export const getUserOnboardingStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const status = await onboardingService.getUserOnboardingStatus(auth.userId);
  sendData(res, status);
});
