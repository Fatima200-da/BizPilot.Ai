import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import * as authService from './auth.service';
import type { ChangePasswordInput, LoginInput, RefreshInput, RegisterInput, RequestPasswordResetInput, ResetPasswordInput } from './auth.validation';

export const registerHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RegisterInput;
  const result = await authService.register(body, { ip: req.ip, userAgent: req.header('User-Agent') });
  sendData(res, result, 201);
});

export const loginHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as LoginInput;
  const result = await authService.login(body, { ip: req.ip, userAgent: req.header('User-Agent') });
  sendData(res, result, 200);
});

export const refreshHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RefreshInput;
  const result = await authService.refresh(body.refreshToken);
  sendData(res, result, 200);
});

export const logoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RefreshInput;
  await authService.logout(body.refreshToken);
  res.status(204).send();
});

export const changePasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as ChangePasswordInput;
  await authService.changePassword(auth.userId, body.currentPassword, body.newPassword);
  res.status(204).send();
});

export const requestPasswordResetHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as RequestPasswordResetInput;
  await authService.requestPasswordReset(body.email);
  // Always 204, regardless of whether the email exists — see
  // auth.service.ts's own doc comment on the account-enumeration defense.
  res.status(204).send();
});

export const resetPasswordHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as ResetPasswordInput;
  await authService.resetPassword(body.token, body.newPassword);
  res.status(204).send();
});
