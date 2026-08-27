/**
 * The identity resolved by the authentication middleware
 * (common/middlewares/auth.ts), per API_CONTRACT.md Section 1.4's
 * Authentication Resolution Flow. Attached to `req.auth`.
 */
export interface AuthContext {
  userId: string;
  isSystemAdmin: boolean;
  /**
   * The workspace the caller's active membership belongs to. A request
   * touching a different `:workspaceId` path parameter is rejected as
   * 404 (never 403 — API_CONTRACT.md Section 1.5's anti-enumeration rule),
   * not silently re-scoped.
   */
  workspaceId: string;
  workspaceMemberId: string;
  roleId: string;
  roleKey: string;
  permissionKeys: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
