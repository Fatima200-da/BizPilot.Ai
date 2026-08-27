import type { NextFunction, Request, Response } from 'express';
import { AuthRequiredError, InsufficientPermissionError } from '../errors/app-error';

/**
 * The shared `authorize(permissionKey)` guard (BACKEND_ARCHITECTURE.md
 * Section 3.2), invoking AUTH_ARCHITECTURE.md Section 4.5's permission
 * pipeline. Permission keys are resolved onto the access token at sign-in
 * time (modules/auth) — this guard is a pure, synchronous membership check
 * against that already-resolved set, not a fresh database round-trip per
 * request.
 *
 * `isSystemAdmin` bypasses workspace-level permission checks (internal
 * BizPilot staff, per the User model's own field comment) but never
 * bypasses tenant isolation (workspace-path matching, Section auth.ts).
 */
export function authorize(permissionKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AuthRequiredError());
      return;
    }
    if (req.auth.isSystemAdmin) {
      next();
      return;
    }
    if (!req.auth.permissionKeys.includes(permissionKey)) {
      next(new InsufficientPermissionError(`Missing required permission: ${permissionKey}`));
      return;
    }
    next();
  };
}
