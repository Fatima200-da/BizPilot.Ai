import type { Request } from 'express';
import { AuthRequiredError } from '../errors/app-error';
import type { AuthContext } from '../types/auth-context';

/**
 * Every workspace-scoped route is mounted behind the `authenticate` +
 * `requireWorkspaceContext` middleware (app.ts), so `req.auth` is always
 * populated by the time a controller runs — but the type system doesn't
 * know that. This narrows `AuthContext | undefined` to `AuthContext`
 * without a non-null assertion, throwing the same error the middleware
 * would have thrown if it were somehow bypassed.
 */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw new AuthRequiredError();
  }
  return req.auth;
}
