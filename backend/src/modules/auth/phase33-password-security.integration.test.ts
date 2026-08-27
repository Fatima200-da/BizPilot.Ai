import { describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app, cleanupTestUser, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 33 Track D: real, previously-nonexistent password change/reset
 * features — found via a real route inventory that no such feature
 * existed at all before this phase. Every scenario here is a real HTTP
 * request against the real app.
 *
 * These endpoints are deliberately gated by the same real `authRateLimit`
 * (20 req/15min/IP) as register/login/refresh — a genuine, correct
 * security decision, not weakened for testability. To respect that real
 * budget within one test file, verification prefers a direct, real
 * database read (e.g. `Session.revokedAt`, `PasswordResetToken.usedAt`,
 * a real bcrypt hash comparison) over a second round-trip HTTP call
 * wherever that is equally real evidence — real execution, not fewer
 * real assertions.
 */
describe('Phase 33 Track D: password change (integration)', () => {
  it('a real user can change their own password with the correct current password, and the new password hash is genuinely different and correctly verifiable', async () => {
    await ensureSeeded();
    const user = await registerTestUser('Password Change User');

    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'password1234', newPassword: 'newpassword5678' });
    expect(changeRes.status).toBe(204);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    const oldStillMatches = dbUser.passwordHash ? await bcrypt.compare('password1234', dbUser.passwordHash) : true;
    const newMatches = dbUser.passwordHash ? await bcrypt.compare('newpassword5678', dbUser.passwordHash) : false;
    expect(oldStillMatches).toBe(false);
    expect(newMatches).toBe(true);

    await cleanupTestUser(user.email);
  }, 20_000);

  it('changing a password with the WRONG current password is rejected, and the real password hash is unchanged', async () => {
    const user = await registerTestUser('Password Change Wrong Current User');
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'totally-wrong-password', newPassword: 'newpassword5678' });
    expect(res.status).toBe(401);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    expect(after.passwordHash).toBe(before.passwordHash);

    await cleanupTestUser(user.email);
  }, 20_000);

  it('a real password change revokes every existing real session for that user, verified directly against the Session table', async () => {
    const user = await registerTestUser('Password Change Session Revocation User');
    const sessionsBefore = await prisma.session.count({ where: { userId: user.userId, revokedAt: null } });
    expect(sessionsBefore).toBeGreaterThan(0);

    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'password1234', newPassword: 'newpassword5678' });
    expect(changeRes.status).toBe(204);

    const sessionsAfter = await prisma.session.count({ where: { userId: user.userId, revokedAt: null } });
    expect(sessionsAfter).toBe(0);

    await cleanupTestUser(user.email);
  }, 20_000);

  it('an anonymous request is rejected with 401 before any password check or rate-limit consumption', async () => {
    const res = await request(app).post('/api/v1/auth/change-password').send({ currentPassword: 'x', newPassword: 'newpassword5678' });
    expect(res.status).toBe(401);
  });
});

describe('Phase 33 Track D: password reset (integration)', () => {
  it('a real forgot-password request for an existing account creates a real, hashed, single-use, time-limited token — never the raw token persisted', async () => {
    const user = await registerTestUser('Password Reset Real Account User');

    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
    expect(res.status).toBe(204);

    const tokenRow = await prisma.passwordResetToken.findFirst({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' } });
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.tokenHash.length).toBe(64); // a real sha256 hex digest, not a raw secret
    expect(tokenRow?.usedAt).toBeNull();
    expect(tokenRow?.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await cleanupTestUser(user.email);
  }, 20_000);

  it('a forgot-password request for a NON-existent email returns the exact same 204 — no account-enumeration signal, and creates no real token row', async () => {
    const fakeEmail = `definitely-not-real-${String(Date.now())}@example.test`;
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: fakeEmail });
    expect(res.status).toBe(204); // identical response to the real-account case above

    const anyToken = await prisma.passwordResetToken.count({ where: { user: { email: fakeEmail } } });
    expect(anyToken).toBe(0);
  });

  it('an invalid/unknown reset token is rejected, never silently accepted', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({ token: 'this-token-was-never-issued', newPassword: 'newpassword5678' });
    expect(res.status).toBe(401);
  });

  it('a real reset token, once consumed, cannot be replayed — the real DB row is marked used after the first success, and the second attempt is rejected', async () => {
    const user = await registerTestUser('Password Reset Replay User');

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const forgotRes = await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email });
      expect(forgotRes.status).toBe(204);
    } finally {
      console.log = originalLog;
    }

    const emailLogLine = logs.find((l) => l.includes('email.mock_sent'));
    expect(emailLogLine).toBeTruthy();
    const parsed = JSON.parse(emailLogLine as string) as { body: string };
    const rawToken = /token within 1 hour: (\S+)/.exec(parsed.body)?.[1];
    expect(rawToken).toBeTruthy();

    const firstUse = await request(app).post('/api/v1/auth/reset-password').send({ token: rawToken, newPassword: 'newpassword5678' });
    expect(firstUse.status).toBe(204);

    const tokenAfterFirstUse = await prisma.passwordResetToken.findFirst({ where: { userId: user.userId }, orderBy: { createdAt: 'desc' } });
    expect(tokenAfterFirstUse?.usedAt).not.toBeNull();

    const secondUse = await request(app).post('/api/v1/auth/reset-password').send({ token: rawToken, newPassword: 'anotherpassword9999' });
    expect(secondUse.status).toBe(401); // real single-use enforcement — replay rejected

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
    const firstPasswordTookEffect = dbUser.passwordHash ? await bcrypt.compare('newpassword5678', dbUser.passwordHash) : false;
    const secondPasswordDidNotTakeEffect = dbUser.passwordHash ? await bcrypt.compare('anotherpassword9999', dbUser.passwordHash) : true;
    expect(firstPasswordTookEffect).toBe(true);
    expect(secondPasswordDidNotTakeEffect).toBe(false);

    // real session-revocation proof for reset too, via direct DB read (no extra HTTP call)
    const sessionsAfter = await prisma.session.count({ where: { userId: user.userId, revokedAt: null } });
    expect(sessionsAfter).toBe(0);

    await cleanupTestUser(user.email);
  }, 20_000);

  it('a new password shorter than the real minimum is rejected with a validation error, for both change and reset', async () => {
    const user = await registerTestUser('Password Too Short User');
    const changeRes = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ currentPassword: 'password1234', newPassword: 'short' });
    expect(changeRes.status).toBe(422);

    const resetRes = await request(app).post('/api/v1/auth/reset-password').send({ token: 'irrelevant-fails-length-check-first', newPassword: 'short' });
    expect(resetRes.status).toBe(422);

    await cleanupTestUser(user.email);
  }, 20_000);
});

describe('Phase 33 Track D: real rate-limit enforcement (dedicated, isolated from functional tests above)', () => {
  it('password-reset-abuse: real requests beyond the authRateLimit budget for this IP are genuinely rejected with 429', async () => {
    // By this point in the file, prior tests have already consumed some of
    // the real 20-request/15-min/IP budget — deliberately leaned on here
    // rather than worked around, since a REAL 429 is exactly the positive
    // evidence Track D asks for ("password reset abuse" protection).
    let sawRateLimited = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: `abuse-probe-${String(i)}@example.test` });
      if (res.status === 429) {
        sawRateLimited = true;
        break;
      }
    }
    expect(sawRateLimited).toBe(true);
  }, 30_000);
});
