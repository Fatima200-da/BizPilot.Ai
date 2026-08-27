import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

/**
 * AUTH_ARCHITECTURE.md Section 3.7: access tokens are short-lived JWTs.
 * Workspace claims are optional because a freshly-registered user has no
 * workspace yet — workspace-scoped routes require them via the
 * `requireWorkspaceContext` middleware, not this signing step.
 */
export interface AccessTokenPayload {
  sub: string; // userId
  isSystemAdmin: boolean;
  workspaceId?: string;
  workspaceMemberId?: string;
  roleId?: string;
  roleKey?: string;
  permissionKeys?: string[];
  type: 'access';
}

export interface RefreshTokenPayload {
  sub: string; // userId
  sessionId: string;
  type: 'refresh';
}

// Phase 32 Track G: explicit algorithm pinning — real-execution testing
// confirmed the installed `jsonwebtoken` version already rejects a forged
// `alg: none` token by default (not an active vulnerability), but relying
// on a library default for this is exactly the fragility the OWASP JWT
// Cheat Sheet warns against: a future dependency upgrade, or any future
// code path that introduces an asymmetric (RS/ES) key anywhere in this
// process, could silently widen what `verify` accepts. Pinning HS256
// explicitly on both sign and verify closes that entire class of future
// risk today, at zero behavioral cost for the real HS256-only tokens this
// app has always issued.
const JWT_ALGORITHM = 'HS256';

export function signAccessToken(payload: Omit<AccessTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'access' }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  } as jwt.SignOptions);
}

export function signRefreshToken(payload: Omit<RefreshTokenPayload, 'type'>): string {
  return jwt.sign({ ...payload, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    algorithm: JWT_ALGORITHM,
  } as jwt.SignOptions);
}

/**
 * `jwt.verify` only proves the signature is valid — it says nothing about
 * the payload's shape. A token signed with our secret but carrying, say, a
 * refresh-token payload (or a payload from a future token type) must still
 * be rejected here at the boundary, not trusted by an unchecked cast.
 */
function decodeUnknown(token: string, secret: string): Record<string, unknown> {
  const decoded: unknown = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });
  if (typeof decoded !== 'object' || decoded === null) {
    throw new Error('Token payload is not an object.');
  }
  return decoded as Record<string, unknown>;
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = decodeUnknown(token, env.JWT_SECRET);
  if (decoded.type !== 'access' || typeof decoded.sub !== 'string') {
    throw new Error('Not a valid access token');
  }
  return decoded as unknown as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const decoded = decodeUnknown(token, env.JWT_REFRESH_SECRET);
  if (decoded.type !== 'refresh' || typeof decoded.sub !== 'string' || typeof decoded.sessionId !== 'string') {
    throw new Error('Not a valid refresh token');
  }
  return decoded as unknown as RefreshTokenPayload;
}
