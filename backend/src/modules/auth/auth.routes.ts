import { Router } from 'express';
import { validateBody } from '../../common/middlewares/validate';
import { authRateLimit } from '../../common/middlewares/rate-limit';
import { authenticate } from '../../common/middlewares/auth';
import { changePasswordSchema, loginSchema, refreshSchema, registerSchema, requestPasswordResetSchema, resetPasswordSchema } from './auth.validation';
import { changePasswordHandler, loginHandler, logoutHandler, refreshHandler, registerHandler, requestPasswordResetHandler, resetPasswordHandler } from './auth.controller';

export const authRouter = Router();

authRouter.post('/register', authRateLimit, validateBody(registerSchema), registerHandler);
authRouter.post('/login', authRateLimit, validateBody(loginSchema), loginHandler);
authRouter.post('/refresh', authRateLimit, validateBody(refreshSchema), refreshHandler);
authRouter.post('/logout', validateBody(refreshSchema), logoutHandler);
authRouter.post('/change-password', authenticate, authRateLimit, validateBody(changePasswordSchema), changePasswordHandler);
// Phase 33 Track D: real password-reset abuse protection — the same
// authRateLimit (20/15min/IP) every other unauthenticated auth endpoint
// already uses, since a "forgot password" endpoint is exactly the kind of
// unauthenticated, low-cost, high-abuse-potential surface that rate limit
// exists for.
authRouter.post('/forgot-password', authRateLimit, validateBody(requestPasswordResetSchema), requestPasswordResetHandler);
authRouter.post('/reset-password', authRateLimit, validateBody(resetPasswordSchema), resetPasswordHandler);
