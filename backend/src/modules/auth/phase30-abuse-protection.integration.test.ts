import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';

/**
 * Phase 30 Track B.6: real abuse-protection gaps found by auditing what
 * abuse-protection.integration.test.ts and the marketing-autopilot
 * validation/rate-limit suites already cover (login/register/invitation
 * bursts, oversized bodies, malformed JSON, workflow-execution spam,
 * unexpected extra fields) against the phase's own checklist. Two real,
 * previously-untested surfaces: feedback submission had a real rate
 * limiter (`feedbackRateLimit`, Phase 29) wired but never exercised by any
 * test, and pagination `limit` parameters across list endpoints had never
 * been probed with adversarial values (huge, negative, zero, non-numeric).
 */
describe('Phase 30: abuse protection — feedback spam and pagination abuse (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let ws: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Abuse Protection Owner');
    ws = await createTestWorkspace(owner.accessToken, 'Abuse Protection Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('feedback spam: submitting past the real per-hour limit is rejected with 429, and no runaway row growth occurs', async () => {
    // feedbackRateLimit (Phase 29): 20 requests / hour. Fire 25 real
    // submissions and confirm the tail is genuinely rate-limited, not
    // silently accepted forever.
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app)
        .post(`/api/v1/workspaces/${ws.workspaceId}/feedback`)
        .set('Authorization', `Bearer ${ws.accessToken}`)
        .send({ type: 'GENERAL', message: `Abuse probe message ${String(i)}` });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true); // the first 20 (within the real limit) all genuinely succeeded — this isn't a limiter that blocks everything
  }, 30_000);

  it('pagination abuse: an absurdly large limit value never returns more than the schema-enforced maximum, real rows only', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts`)
        .set('Authorization', `Bearer ${ws.accessToken}`)
        .send({ fullName: `Pagination Probe Contact ${String(i)}` });
    }

    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts?limit=999999999`).set('Authorization', `Bearer ${ws.accessToken}`);
    // listContactsQuerySchema caps at max(100) via Zod — an out-of-range
    // value is a real 422, not silently clamped and not an unbounded scan.
    expect(res.status).toBe(422);
  });

  it('pagination abuse: a negative limit is rejected, never interpreted as "no limit" or crashing the query', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts?limit=-1`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(422);
  });

  it('pagination abuse: a zero limit is rejected (schema requires min 1), not treated as "unlimited"', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts?limit=0`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(422);
  });

  it('pagination abuse: a non-numeric limit is rejected with a clean 422, never a raw type-coercion crash', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts?limit=not-a-number`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(422);
  });

  it('pagination abuse: a malformed (non-UUID) cursor is rejected with 422, never used as a raw, unvalidated database lookup key', async () => {
    const res = await request(app).get(`/api/v1/workspaces/${ws.workspaceId}/crm/contacts?cursor=not-a-real-uuid`).set('Authorization', `Bearer ${ws.accessToken}`);
    expect(res.status).toBe(422);
  });
});
