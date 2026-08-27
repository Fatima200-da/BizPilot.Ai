import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAccessToken } from '../../modules/auth/jwt';
import { AuthRequiredError, AuthTokenExpiredError, AuthTokenInvalidError, InsufficientPermissionError, NotFoundError } from '../errors/app-error';
import type { AuthContext } from '../types/auth-context';

/**
 * API_CONTRACT.md Section 1.4's Authentication Resolution Flow, Bearer-only
 * (cookie-based auth is a documented future extension — AUTH_ARCHITECTURE.md
 * Section 5.3 — not implemented in this MVP slice; see completion report).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('Authorization');
  if (!header?.startsWith('Bearer ')) {
    next(new AuthRequiredError());
    return;
  }
  const token = header.slice('Bearer '.length);

  try {
    const payload = verifyAccessToken(token);
    const auth: AuthContext = {
      userId: payload.sub,
      isSystemAdmin: payload.isSystemAdmin,
      workspaceId: payload.workspaceId ?? '',
      workspaceMemberId: payload.workspaceMemberId ?? '',
      roleId: payload.roleId ?? '',
      roleKey: payload.roleKey ?? '',
      permissionKeys: payload.permissionKeys ?? [],
    };
    req.auth = auth;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      next(new AuthTokenExpiredError());
      return;
    }
    next(new AuthTokenInvalidError());
  }
}

/**
 * Guards routes that require an active workspace scope (i.e. every route
 * except auth/workspace-creation itself) — a token minted before the user
 * had a workspace has empty workspace claims and must be rejected here,
 * not allowed to fall through with an empty-string workspaceId.
 */
export function requireWorkspaceContext(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth?.workspaceId) {
    next(new AuthRequiredError('This action requires an active workspace. Create or select a workspace first.'));
    return;
  }
  next();
}

/**
 * API_CONTRACT.md Section 1.5: path-parameter workspaceId must equal the
 * token's workspaceId claim. A mismatch is 404, never 403 (anti-enumeration
 * — a caller must never learn a workspace exists that they cannot access).
 */
export function enforceWorkspacePathMatch(req: Request, _res: Response, next: NextFunction): void {
  const pathWorkspaceId = req.params.workspaceId;
  if (pathWorkspaceId && req.auth?.workspaceId !== pathWorkspaceId) {
    next(new NotFoundError());
    return;
  }
  next();
}

/**
 * Phase 26 Section 7: admin routes must NEVER trust `isAdmin` from client
 * input (a header, a body field, a query param). The only source of truth
 * is `req.auth.isSystemAdmin`, which `authenticate` above resolves
 * exclusively from the cryptographically-verified JWT payload — there is
 * no other code path that sets it. A normal user or even a workspace OWNER
 * (workspace-level role, unrelated to platform-level admin status) gets
 * 403, not a workspace-scoped check.
 */
export function requireSystemAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new AuthRequiredError());
    return;
  }
  if (!req.auth.isSystemAdmin) {
    next(new InsufficientPermissionError('This action requires platform administrator access.'));
    return;
  }
  next();
}
