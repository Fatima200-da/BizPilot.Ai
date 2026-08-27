import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser, uniqueEmail } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 26 Section 21: real p50/p95/p99 measurement against real Postgres
 * (not fabricated thresholds — this test records and reports whatever the
 * real numbers are; it does not assert against invented SLAs beyond a
 * generous sanity ceiling).
 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function summarize(label: string, samples: number[]): void {
  const sorted = [...samples].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  console.log(`[perf] ${label}: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms p99=${p99.toFixed(2)}ms n=${String(samples.length)}`);
}

describe('Phase 26 production endpoint performance (integration, real Postgres)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let adminToken: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Perf26 Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Perf26 Workspace');
    await prisma.user.update({ where: { id: owner.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'password1234' });
    adminToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  }, 30_000);

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('register: p50/p95/p99 over 20 real registrations', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).post('/api/v1/auth/register').send({ email: uniqueEmail(`perf-reg-${String(i)}`), password: 'password1234', fullName: 'Perf Test' });
      samples.push(performance.now() - start);
    }
    summarize('register', samples);
    expect(percentile([...samples].sort((a, b) => a - b), 95)).toBeLessThan(2000);
  }, 30_000);

  it('login: p50/p95/p99 over 20 real logins', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'password1234' });
      samples.push(performance.now() - start);
    }
    summarize('login', samples);
  }, 30_000);

  it('subscription lookup (dashboard component): p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/subscription`).set('Authorization', `Bearer ${workspace.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('subscription lookup', samples);
  }, 30_000);

  it('usage lookup (dashboard component): p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/usage`).set('Authorization', `Bearer ${workspace.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('usage lookup', samples);
  }, 30_000);

  it('notification list: p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${owner.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('notification list', samples);
  }, 30_000);

  it('workflow creation: p50/p95/p99 over 15 real workflow-trigger requests', async () => {
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Perf Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    const businessProfileId = (profileRes.body as { data: { id: string } }).data.id;

    const samples: number[] = [];
    for (let i = 0; i < 15; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app)
        .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspace.accessToken}`)
        .send({ businessProfileId, idempotencyKey: `perf26-${String(i)}-${String(Date.now())}` });
      samples.push(performance.now() - start);
    }
    summarize('workflow creation (full AI trigger pipeline, mock provider)', samples);
  }, 30_000);

  it('notification creation (internal, via a real subscription-change event): p50/p95/p99', async () => {
    const { changePlan } = await import('./subscription.service');
    const samples: number[] = [];
    const plans = ['starter', 'pro', 'business', 'pro', 'starter', 'pro', 'business', 'pro', 'starter', 'pro'];
    for (const plan of plans) {
      const start = performance.now();
      // sequential timing samples are the point
      await changePlan(workspace.workspaceId, plan, owner.userId);
      samples.push(performance.now() - start);
    }
    summarize('subscription change (includes notification creation)', samples);
  }, 30_000);

  it('admin lookup: p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get(`/api/v1/admin/workspaces/${workspace.workspaceId}`).set('Authorization', `Bearer ${adminToken}`);
      samples.push(performance.now() - start);
    }
    summarize('admin workspace inspection', samples);
  }, 30_000);
});
