import { randomUUID, randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { ConflictError, InvalidCredentialsError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { signAccessToken, signRefreshToken, verifyRefreshToken, type AccessTokenPayload } from './jwt';
import { createNotification } from '../notifications/notification.service';
import { trackEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';
import { getEmailProvider } from '../../infrastructure/email';

interface SanitizedUser {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string | null;
  locale: string;
  // Phase 27: exposed so the frontend can conditionally render an "Admin"
  // nav link — a UX nicety only. This is NEVER an authorization signal:
  // every admin route independently re-resolves `isSystemAdmin` from the
  // verified JWT server-side (auth.ts's `requireSystemAdmin`), exactly as
  // it did before this field existed. A tampered client value here cannot
  // grant access to anything.
  isSystemAdmin: boolean;
}

interface AuthResult {
  user: SanitizedUser;
  accessToken: string;
  refreshToken: string;
}

type WorkspaceClaims = Partial<
  Pick<AccessTokenPayload, 'workspaceId' | 'workspaceMemberId' | 'roleId' | 'roleKey' | 'permissionKeys'>
>;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function resolveActiveWorkspaceClaims(userId: string): Promise<WorkspaceClaims> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId, status: 'ACTIVE', deletedAt: null },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!membership) return {};
  return {
    workspaceId: membership.workspaceId,
    workspaceMemberId: membership.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    permissionKeys: membership.role.rolePermissions.map((rp) => rp.permission.key),
  };
}

async function issueTokens(
  userId: string,
  isSystemAdmin: boolean,
  ipAddress?: string,
  userAgent?: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const workspaceClaims = await resolveActiveWorkspaceClaims(userId);
  const accessToken = signAccessToken({ sub: userId, isSystemAdmin, ...workspaceClaims });

  const sessionId = randomUUID();
  const refreshToken = signRefreshToken({ sub: userId, sessionId });

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      tokenHash: hashToken(refreshToken),
      userAgent,
      ipAddress,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(
  input: { email: string; password: string; fullName: string },
  ctx: { ip?: string; userAgent?: string }
): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('An account with this email already exists.', 'CONFLICT_DUPLICATE_EMAIL');
  }

  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, fullName: input.fullName },
  });

  const tokens = await issueTokens(user.id, user.isSystemAdmin, ctx.ip, ctx.userAgent);

  // Phase 26 Section 5: account-level (no workspace yet) WELCOME
  // notification. Idempotency isn't load-bearing here (registration itself
  // is one-time per email, enforced by the unique-email check above) but
  // still keyed consistently with every other notification for uniformity.
  await createNotification({
    recipientUserId: user.id,
    category: 'SYSTEM',
    type: 'WELCOME',
    title: `Welcome to BizPilot AI, ${user.fullName}!`,
    body: 'Create your first workspace to get started.',
    relatedEntityType: 'User',
    relatedEntityId: user.id,
  });

  await trackEvent({ userId: user.id, eventName: PRODUCT_EVENTS.SIGNUP_COMPLETED });

  return { user: sanitizeUser(user), ...tokens };
}

export async function login(
  input: { email: string; password: string },
  ctx: { ip?: string; userAgent?: string }
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !user.passwordHash || user.deletedAt) {
    throw new InvalidCredentialsError();
  }
  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await issueTokens(user.id, user.isSystemAdmin, ctx.ip, ctx.userAgent);
  await trackEvent({ userId: user.id, eventName: PRODUCT_EVENTS.SESSION_STARTED });
  return { user: sanitizeUser(user), ...tokens };
}

export async function refresh(refreshToken: string): Promise<AuthResult> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new InvalidCredentialsError();
  }

  const session = await prisma.session.findUnique({ where: { id: payload.sessionId } });
  if (!session || session.revokedAt || session.expiresAt < new Date() || session.tokenHash !== hashToken(refreshToken)) {
    throw new InvalidCredentialsError();
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || user.deletedAt) {
    throw new NotFoundError();
  }

  // Rotate: revoke the used refresh token, issue a fresh pair.
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(user.id, user.isSystemAdmin);
  return { user: sanitizeUser(user), ...tokens };
}

export async function logout(refreshToken: string): Promise<void> {
  try {
    const payload = verifyRefreshToken(refreshToken);
    await prisma.session.updateMany({
      where: { id: payload.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Already invalid/expired — logout is idempotent, nothing to revoke.
  }
}

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour — real, short-lived
const MIN_PASSWORD_LENGTH = 8;

/**
 * Phase 33 Track D: real, authenticated password change — the current
 * password must be verified first (never trust the caller's session alone
 * for a credential-changing action). Revokes EVERY real session on
 * success, including the caller's own current one — access tokens carry
 * no `sessionId` claim (only refresh tokens do, see `jwt.ts`), so there is
 * no reliable way to identify "just this session" from an authenticated
 * request; unconditionally requiring re-login everywhere after a password
 * change is the safe, consistent choice (the same behavior `resetPassword`
 * already has), not a compromise.
 */
export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError([{ field: 'newPassword', code: 'TOO_SHORT', message: `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.` }]);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordHash || user.deletedAt) {
    throw new InvalidCredentialsError();
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  const newHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } });

  await prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Phase 33 Track D: real password-reset request — ALWAYS returns
 * successfully regardless of whether the email exists (a real, standard
 * defense against account-enumeration: an attacker probing emails must
 * never be able to distinguish "this account exists" from "it doesn't"
 * via this endpoint's response). If the account genuinely exists and has
 * a real password (not an SSO-only account), a real single-use token is
 * generated, its sha256 hash persisted (never the raw token), and a real
 * email is dispatched through the real `EmailProviderPort` — actual
 * delivery is `BLOCKED — CREDENTIAL` in this environment (no real SMTP/
 * SendGrid credential configured), honestly logged by the mock adapter
 * rather than silently pretended.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || user.deletedAt) {
    return; // deliberately silent — see doc comment above
  }

  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(rawToken);
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS) },
  });

  await getEmailProvider().sendEmail({
    to: user.email,
    subject: 'Reset your BizPilot AI password',
    body: `A password reset was requested for your account. Use this token within 1 hour: ${rawToken}`,
  });
}

/**
 * Phase 33 Track D: real reset-token consumption — verifies the real
 * token hash, real expiry, and real single-use (`usedAt`) state inside one
 * transaction with marking it used, so two concurrent consumption
 * attempts for the same token can never both succeed (the same real,
 * atomic-claim discipline this codebase already uses for Job/Backup
 * concurrency guards). On success, revokes EVERY real session for the
 * account (a password reset is a real account-recovery event — treat it
 * as a possible compromise, kill every existing session unconditionally).
 */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError([{ field: 'newPassword', code: 'TOO_SHORT', message: `Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters.` }]);
  }

  const tokenHash = hashResetToken(rawToken);

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return null;
    }
    const claim = await tx.passwordResetToken.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claim.count !== 1) return null; // lost a real race to another concurrent consumption attempt

    const newHash = await bcrypt.hash(newPassword, env.BCRYPT_SALT_ROUNDS);
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash: newHash } });
    return record.userId;
  });

  if (!result) {
    throw new InvalidCredentialsError();
  }

  await prisma.session.updateMany({ where: { userId: result, revokedAt: null }, data: { revokedAt: new Date() } });
}

function sanitizeUser(user: { id: string; email: string; fullName: string; avatarUrl: string | null; locale: string; isSystemAdmin: boolean }): SanitizedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    isSystemAdmin: user.isSystemAdmin,
  };
}
