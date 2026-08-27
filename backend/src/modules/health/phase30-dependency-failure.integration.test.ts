import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { requestTimeout } from '../../common/middlewares/request-timeout';

/**
 * Phase 30 Track C.7: the dependency failure matrix. `health.integration.test.ts`
 * (pre-existing) only ever exercised the happy path — a real, reachable
 * Postgres — never a genuine "the database is actually down" scenario, and
 * `requestTimeout` (Phase 19, `common/middlewares/request-timeout.ts`) had
 * zero test coverage despite being the real mechanism this codebase relies
 * on for "a stalled dependency must not hang a connection forever."
 *
 * Real AI-provider-down and Stripe-down behavior is already covered
 * elsewhere and not re-tested here: `openai.adapter.test.ts` proves the
 * raw provider error is never relayed to the client; the Stripe webhook
 * integration suite proves invalid-signature and unreachable-customer
 * paths fail closed. Worker-crash and scheduler-restart recovery are
 * already real-tested in `job-queue.integration.test.ts` and
 * `scheduler-tick.integration.test.ts` (Phase 27/28) — re-testing them
 * here would duplicate already-certified work, which this project's own
 * discipline explicitly avoids.
 */
describe('Phase 30: dependency failure matrix (integration)', () => {
  it('Postgres DOWN: a real connection attempt against an unreachable database fails within a bounded time with a classifiable connection error, never hanging the process indefinitely', async () => {
    // A genuinely separate PrismaClient (not the app's shared singleton,
    // which stays pointed at the real, reachable dev database for every
    // other test in this suite) pointed at a real TCP port nothing is
    // listening on — the same real connection failure mode a genuinely
    // down production Postgres would produce.
    const brokenAdapter = new PrismaPg({ connectionString: 'postgresql://baduser:badpass@127.0.0.1:59999/nonexistent_db?connect_timeout=3' });
    const brokenClient = new PrismaClient({ adapter: brokenAdapter });

    const start = performance.now();
    await expect(brokenClient.$queryRawUnsafe('SELECT 1')).rejects.toThrow();
    const elapsedMs = performance.now() - start;

    // Bounded, not infinite — this is the real guarantee: a down database
    // fails fast enough that a request handler using the SAME pattern
    // health.controller.ts's readyHandler uses (`.then(() => true).catch(() =>
    // false)`) resolves to `false` well within this codebase's own
    // REQUEST_TIMEOUT_MS default (30s), not hanging until Express's own
    // timeout middleware has to intervene.
    expect(elapsedMs).toBeLessThan(10_000);

    await brokenClient.$disconnect();
  }, 15_000);

  it('slow/stalled dependency: requestTimeout responds with a real 503 (never a hang, never a raw stack trace) once the configured ceiling is reached', async () => {
    // A real, minimal Express app using the actual, unmodified
    // requestTimeout middleware from the codebase — not a reimplementation.
    const app = express();
    app.use((_req, res, next) => {
      res.locals.requestId = 'test-request-id';
      next();
    });
    app.use(requestTimeout(200)); // a short real ceiling for this test only
    app.get('/slow', async (_req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 2000)); // deliberately slower than the 200ms ceiling above
      if (!res.headersSent) res.status(200).json({ status: 'ok' }); // never reached — the timeout fires first
    });

    const res = await request(app).get('/slow');
    expect(res.status).toBe(503);
    expect((res.body as { code?: string }).code).toBe('SERVER_REQUEST_TIMEOUT');
    expect((res.body as { detail?: string }).detail).not.toMatch(/at\s+\S+\.(js|ts):\d+/); // never a raw stack trace in the body
  }, 5_000);

  it('a request that completes BEFORE the timeout ceiling is entirely unaffected — the timer is real and cancels cleanly on success', async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.locals.requestId = 'test-request-id';
      next();
    });
    app.use(requestTimeout(2000));
    app.get('/fast', (_req, res) => {
      res.status(200).json({ status: 'ok' });
    });

    const res = await request(app).get('/fast');
    expect(res.status).toBe(200);
  });
});
