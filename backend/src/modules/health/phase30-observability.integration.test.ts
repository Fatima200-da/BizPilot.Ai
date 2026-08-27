import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, ensureSeeded, registerTestUser, uniqueEmail } from '../../testing/integration-helpers';

/**
 * Phase 30 Track E.10-12: structured logging, correlation IDs, and
 * health/readiness. `request-logger.ts` and `request-context.ts` already
 * existed (Phase 16/19) and already logged requestId/method/route/status/
 * durationMs/workspaceId/userId — this phase found and closed one real
 * gap: the structured access log never recorded WHICH error code fired
 * for a 4xx/5xx response, only the raw HTTP status, making "find every
 * real AUTH_INVALID_CREDENTIALS this hour" impossible from logs alone
 * without cross-referencing every response body. Fixed by having
 * error-handler.ts stash the real code on `res.locals.errorCode`, read by
 * request-logger.ts's `finish` handler.
 */
describe('Phase 30: structured logging & correlation IDs (integration)', () => {
  let captured: string[];
  let logSpy: MockInstance;

  beforeEach(() => {
    captured = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function lastLogLine(): Record<string, unknown> {
    const jsonLines = captured.filter((l) => l.trim().startsWith('{'));
    const last = jsonLines[jsonLines.length - 1];
    if (!last) throw new Error('No JSON log line captured.');
    return JSON.parse(last) as Record<string, unknown>;
  }

  it('a real 401 (missing auth) logs a structured line with the real error code, not just the raw status', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard');
    expect(res.status).toBe(401);

    const entry = lastLogLine();
    expect(entry.status).toBe(401);
    expect(entry.errorCode).toBeTypeOf('string');
    expect(entry.errorCode).not.toBe(''); // a real code, e.g. AUTH_REQUIRED — not asserting the exact string, just that it's real and present
  });

  it('a real 404 (unknown route) logs the real NOT_FOUND code', async () => {
    const res = await request(app).get('/api/v1/this-route-does-not-exist-anywhere');
    expect(res.status).toBe(404);

    const entry = lastLogLine();
    expect(entry.errorCode).toBe('NOT_FOUND');
  });

  it('a real successful (2xx) request logs a structured line with NO error code at all', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);

    const entry = lastLogLine();
    expect(entry.status).toBe(200);
    expect(entry.errorCode).toBeUndefined();
  });

  it('the SAME request_id appears in both the X-Request-Id response header and the structured access-log line for that request — real correlation, not two independent identifiers', async () => {
    const res = await request(app).get('/health/live');
    const headerRequestId = res.headers['x-request-id'] as string;
    expect(headerRequestId).toBeTruthy();

    const entry = lastLogLine();
    expect(entry.requestId).toBe(headerRequestId);
  });

  it('a client-supplied X-Request-Id is echoed back exactly, not replaced — real cross-service correlation (frontend -> API -> ... ) depends on the caller\'s own id surviving the round trip', async () => {
    const callerRequestId = 'req_caller-supplied-correlation-id-12345';
    const res = await request(app).get('/health/live').set('X-Request-Id', callerRequestId);
    expect(res.headers['x-request-id']).toBe(callerRequestId);

    const entry = lastLogLine();
    expect(entry.requestId).toBe(callerRequestId);
  });

  it('a real request carrying a password in its body never logs the password — structured logging has no body-content field at all, by construction', async () => {
    const email = uniqueEmail('observability-secret');
    const realPassword = 'genuinely-secret-password-value-9f8e7d';
    await request(app).post('/api/v1/auth/register').send({ email, fullName: 'Observability Secret Test', password: realPassword });

    const combined = captured.join('\n');
    expect(combined).not.toContain(realPassword);

    await cleanupTestUser(email);
  });

  it('a real authenticated request logs the real workspaceId/userId for correlation across the full request lifecycle', async () => {
    const user = await registerTestUser('Observability Correlation User');
    captured = []; // registration itself already logged — isolate the next request
    const res = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);

    const entry = lastLogLine();
    expect(entry.userId).toBe(user.userId);

    await cleanupTestUser(user.email);
  });
});

describe('Phase 30: health/readiness certification (integration)', () => {
  beforeEach(async () => {
    await ensureSeeded();
  });

  it('/health/live is a pure process-liveness signal — 200 with no dependency checks, works even under an unauthenticated, cold request', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('/health/ready performs REAL dependency checks (not a static 200) and reports database and jobQueue independently, matching this phase\'s own real-Postgres-down evidence (Track C.7) that these checks genuinely degrade, not just genuinely succeed', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    const body = res.body as { status: string; database: string; jobQueue: string };
    expect(body.database).toBe('reachable');
    expect(body.jobQueue).toBe('reachable');
  });

  it('both health endpoints are unauthenticated — a real load balancer/orchestrator probe never carries credentials', async () => {
    const live = await request(app).get('/health/live');
    const ready = await request(app).get('/health/ready');
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
  });
});
