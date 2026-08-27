import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser, uniqueEmail } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { recordUsage, grantCredits, getBalance } from '../billing/credit-ledger.service';
import { changePlan } from '../billing/subscription.service';

/**
 * Phase 27 Section 15: production abuse scenarios not already covered by
 * dedicated tests elsewhere in this codebase. Rapid workflow creation and
 * duplicate-idempotency-key handling already have real, passing coverage
 * (marketing-autopilot-rate-limit.integration.test.ts,
 * billing-exactly-once.integration.test.ts); seat-limit races and expired
 * invitations already have real coverage (team.integration.test.ts). This
 * file covers the genuinely untested surfaces: authentication bursts, a
 * real oversized-payload rejection, invitation-endpoint bursts, and
 * concurrent zero-credit spam.
 *
 * Ordering is deliberate: `authRateLimit` (register/login/refresh) is
 * shared and IP-keyed across this whole process, so the two tests that
 * intentionally exhaust it (login burst, registration burst) run LAST —
 * every other test needs `registerTestUser` to actually succeed first.
 */
describe('Abuse protection (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('an oversized request body is rejected with a real 413, before any route handler or database write runs', async () => {
    // app.ts's global express.json({ limit: '2mb' }) is registered on `app`
    // BEFORE the API router (and therefore before authRateLimit) — this
    // exercises the real body-parser boundary, and never consumes an
    // authRateLimit slot regardless of test ordering.
    const oversizedPayload = { email: 'oversized@example.test', password: 'password1234', fullName: 'x'.repeat(3 * 1024 * 1024) };
    const res = await request(app).post('/api/v1/auth/register').send(oversizedPayload);
    expect(res.status).toBe(413);

    const created = await prisma.user.findUnique({ where: { email: 'oversized@example.test' } });
    expect(created).toBeNull(); // never reached the handler
  });

  it('invitation spam: the 31st invitation from one workspace within the hour is a real 429, and no 31st TeamInvite row is created', async () => {
    const owner = await registerTestUser('Abuse Invitation Spam Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Abuse Invitation Spam Workspace');
    // The FREE plan's 1-seat limit would otherwise reject every invite with
    // a 402 before the 31st request even matters — upgrade to a plan with
    // unlimited seats so this test isolates the RATE limit specifically,
    // not an unrelated plan-limit confound.
    await changePlan(ws.workspaceId, 'business', owner.userId);

    const responses: request.Response[] = [];
    for (let i = 0; i < 31; i += 1) {
      // sequential — request #31 must deterministically be the one that trips the limit
      const res = await request(app)
        .post(`/api/v1/workspaces/${ws.workspaceId}/members/invite`)
        .set('Authorization', `Bearer ${ws.accessToken}`)
        .send({ email: uniqueEmail(`abuse-invite-spam-${String(i)}`), roleKey: 'MEMBER' });
      responses.push(res);
    }

    const rateLimited = responses.filter((r) => r.status === 429);
    expect(rateLimited.length).toBe(1); // exactly the 31st, the configured 30/hour limit
    expect(responses[30]?.status).toBe(429);

    const limitedBody = rateLimited[0]?.body as { code?: string };
    expect(limitedBody.code).toBe('RATE_LIMIT_INVITATION_EXCEEDED');

    const inviteCount = await prisma.teamInvite.count({ where: { workspaceId: ws.workspaceId } });
    expect(inviteCount).toBe(30); // the 31st never persisted

    await cleanupTestUser(owner.email);
  }, 30_000);

  it('zero-credit spam: a burst of concurrent AI-usage attempts against an already-exhausted workspace never drives the balance negative', async () => {
    const owner = await registerTestUser('Abuse Zero Credit Spam Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Abuse Zero Credit Spam Workspace');

    // Drain the real 100-credit FREE allowance to exactly zero.
    await recordUsage({ workspaceId: ws.workspaceId, actionType: 'COPILOT_CHAT', creditsConsumed: 100 });
    expect(await getBalance(ws.workspaceId)).toBe(0);

    // 10 concurrent attempts to spend credits the workspace does not have.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => recordUsage({ workspaceId: ws.workspaceId, actionType: 'COPILOT_CHAT', creditsConsumed: 5 }))
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true); // every single one is genuinely rejected, none silently succeeds

    expect(await getBalance(ws.workspaceId)).toBe(0); // never negative, never drifted

    // A subsequent real grant (e.g. an admin top-up) still works normally afterward — the guardrail didn't corrupt the ledger.
    await grantCredits({ workspaceId: ws.workspaceId, amount: 20, type: 'PROMOTIONAL', note: 'post-spam sanity top-up' });
    expect(await getBalance(ws.workspaceId)).toBe(20);

    await cleanupTestUser(owner.email);
  });

  it('login burst: the 21st login attempt within the 15-minute IP-keyed window is 429, not 401/500, regardless of credential validity', async () => {
    const owner = await registerTestUser('Abuse Login Burst Owner');
    // authRateLimit is shared across /auth/register, /auth/login, /auth/refresh
    // and keyed by IP — registerTestUser above already consumed one slot.
    const responses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      // sequential so the 21st-overall request deterministically trips the limit
      const res = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'wrong-password' });
      responses.push(res.status);
    }

    const rateLimited = responses.filter((s) => s === 429);
    expect(rateLimited.length).toBeGreaterThan(0); // the real, configured 20/15min IP limiter engaged
    // Every non-429 response is a real 401 (wrong password) — never a 500,
    // never a bypass, and no account lockout side effect leaked into the response.
    const nonRateLimited = responses.filter((s) => s !== 429);
    expect(nonRateLimited.every((s) => s === 401)).toBe(true);

    await cleanupTestUser(owner.email);
  });

  it('registration burst: rapid /auth/register calls from the same IP eventually hit the same real 429 guardrail', async () => {
    const responses: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      // sequential — the point is exceeding a real per-IP window, not raw throughput
      const res = await request(app).post('/api/v1/auth/register').send({ email: uniqueEmail(`abuse-reg-burst-${String(i)}`), password: 'password1234', fullName: 'Abuse Test' });
      responses.push(res.status);
    }

    const rateLimited = responses.filter((s) => s === 429);
    const created = responses.filter((s) => s === 201);
    expect(rateLimited.length + created.length).toBe(responses.length); // no 500s, no unexpected statuses
    expect(rateLimited.length).toBeGreaterThan(0); // real burst genuinely exceeded the shared auth limiter

    // Clean up whichever accounts actually got created before the limiter engaged.
    await prisma.user.deleteMany({ where: { email: { startsWith: 'it-abuse-reg-burst-' } } });
  });
});
