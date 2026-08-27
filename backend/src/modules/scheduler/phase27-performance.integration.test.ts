import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { enqueueJob, claimJob } from './job-queue.service';

/**
 * Phase 27 Section 19: real p50/p95/p99 measurement for this phase's new
 * endpoints, against real PostgreSQL — never fabricated thresholds. Follows
 * the same pattern as Phase 26's phase26-performance.integration.test.ts.
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

describe('Phase 27 production endpoint performance (integration, real Postgres)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let adminToken: string;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Perf27 Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Perf27 Workspace');
    const { prisma } = await import('../../infrastructure/database/prisma');
    await prisma.user.update({ where: { id: owner.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: owner.email, password: 'password1234' });
    adminToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;
  }, 30_000);

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('onboarding status lookup: p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get(`/api/v1/workspaces/${workspace.workspaceId}/onboarding`).set('Authorization', `Bearer ${workspace.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('onboarding status lookup', samples);
    expect(percentile([...samples].sort((a, b) => a - b), 95)).toBeLessThan(2000);
  }, 30_000);

  it('user-level onboarding status (no workspace path param): p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get('/api/v1/onboarding/status').set('Authorization', `Bearer ${owner.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('user-level onboarding status', samples);
  }, 30_000);

  it('notification mark-read: p50/p95/p99', async () => {
    const { createNotification } = await import('../notifications/notification.service');
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const { notification } = await createNotification({
        workspaceId: workspace.workspaceId,
        recipientUserId: owner.userId,
        category: 'SYSTEM',
        type: 'SECURITY_EVENT',
        title: 'Perf test notification',
        relatedEntityId: `perf27-notif-${String(i)}`,
      });
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).patch(`/api/v1/notifications/${notification.id}/read`).set('Authorization', `Bearer ${owner.accessToken}`);
      samples.push(performance.now() - start);
    }
    summarize('notification mark-read', samples);
  }, 30_000);

  it('admin dashboard metrics: p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get('/api/v1/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
      samples.push(performance.now() - start);
    }
    summarize('admin dashboard metrics (real aggregate queries across the whole DB)', samples);
  }, 30_000);

  it('admin user search: p50/p95/p99', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      // sequential timing samples are the point
      await request(app).get('/api/v1/admin/users').query({ q: 'Perf27' }).set('Authorization', `Bearer ${adminToken}`);
      samples.push(performance.now() - start);
    }
    summarize('admin user search', samples);
  }, 30_000);

  it('job-queue claim: p50/p95/p99 over 20 real enqueue+claim cycles', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const jobKey = `perf27-claim-${randomUUID()}`;
      // enqueue must precede its own claim, this loop is inherently sequential
      await enqueueJob({ jobKey, dedupeKey: 'perf-test' });
      const start = performance.now();
      // sequential timing samples are the point
      await claimJob(jobKey, `perf-worker-${String(i)}`);
      samples.push(performance.now() - start);
    }
    summarize('job-queue claim (enqueue -> claim latency)', samples);
  }, 30_000);
});
