import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../testing/integration-helpers';

/**
 * Phase 27 Section 17: liveness vs readiness must be genuinely distinct —
 * previously implemented (health.controller.ts) but never actually
 * exercised by a real HTTP test. `/health/live` says nothing about
 * dependencies (a pure "process is up" signal); `/health/ready` performs a
 * real database round-trip and a real job-queue table check, reported as
 * two independent fields, not collapsed into one boolean.
 */
describe('Health & readiness endpoints (integration)', () => {
  it('GET /health/live returns 200 with no dependency information — a pure liveness signal', async () => {
    const res = await request(app).get('/health/live');
    expect(res.status).toBe(200);
    const body = res.body as { status: string; database?: unknown; jobQueue?: unknown };
    expect(body.status).toBe('ok');
    expect(body.database).toBeUndefined(); // liveness never reports on dependencies — that's readiness's job
    expect(body.jobQueue).toBeUndefined();
  });

  it('GET /health/ready performs real dependency checks and reports database and jobQueue independently', async () => {
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    const body = res.body as { status: string; database: string; jobQueue: string };
    expect(body.status).toBe('ok');
    expect(body.database).toBe('reachable'); // a genuine SELECT 1 against real Postgres just ran
    expect(body.jobQueue).toBe('reachable'); // a genuine query against the real jobs table just ran
  });

  it('readiness never leaks connection strings, credentials, or raw driver errors', async () => {
    const res = await request(app).get('/health/ready');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/postgresql:\/\/|password|DATABASE_URL|at Object\.|\.ts:\d+/i);
  });

  it('is unauthenticated — a load balancer/orchestrator health check never carries credentials', async () => {
    const live = await request(app).get('/health/live');
    const ready = await request(app).get('/health/ready');
    expect(live.status).not.toBe(401);
    expect(ready.status).not.toBe(401);
  });
});
