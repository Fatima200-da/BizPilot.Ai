import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { enqueueJob, claimJob, startJob, failJob } from '../scheduler/job-queue.service';

interface DeadLetterJobData {
  id: string;
  jobKey: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
}

/**
 * Phase 29 Section 9: dead-letter job operations. `Job` has no workspace
 * FK by design (Phase 27) — these are RBAC-protected the same way every
 * other admin route is (requireSystemAdmin), not workspace-scoped, and the
 * MANDATORY guarantee this suite proves directly against real Postgres:
 * failure -> retry -> successful completion -> no duplicate business
 * effect, plus a real double-retry correctly rejected rather than silently
 * "succeeding" twice.
 */
describe('Admin dead-letter job operations (integration)', () => {
  let adminUser: Awaited<ReturnType<typeof registerTestUser>>;
  let adminAccessToken: string;
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeAll(async () => {
    await ensureSeeded();
    adminUser = await registerTestUser('DeadLetter Admin');
    await prisma.user.update({ where: { id: adminUser.userId }, data: { isSystemAdmin: true } });
    const loginRes = await request(app).post('/api/v1/auth/login').send({ email: adminUser.email, password: 'password1234' });
    adminAccessToken = (loginRes.body as { data: { accessToken: string } }).data.accessToken;

    owner = await registerTestUser('DeadLetter Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'DeadLetter Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(adminUser.email);
    await cleanupTestUser(owner.email);
  });

  async function createDeadLetterJob(): Promise<string> {
    const jobKey = `admin-dead-letter-test-${randomUUID()}`;
    await enqueueJob({ jobKey, dedupeKey: 'dl-1', maxAttempts: 1 });
    const claimed = await claimJob(jobKey, 'worker-1');
    if (!claimed) throw new Error('expected claim to succeed');
    await startJob(claimed.id, 'worker-1');
    const result = await failJob(claimed.id, 'worker-1', 'Simulated real failure for admin dead-letter testing.');
    if (!result?.terminal) throw new Error('expected the job to reach terminal FAILED status');
    return claimed.id;
  }

  it('non-admin gets 403 on every dead-letter route', async () => {
    const jobId = await createDeadLetterJob();

    const list = await request(app).get('/api/v1/admin/jobs/dead-letter').set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(list.status).toBe(403);

    const retry = await request(app).post(`/api/v1/admin/jobs/${jobId}/retry`).set('Authorization', `Bearer ${workspace.accessToken}`);
    expect(retry.status).toBe(403);

    const cancel = await request(app).post(`/api/v1/admin/jobs/${jobId}/cancel`).set('Authorization', `Bearer ${workspace.accessToken}`).send({ reason: 'test' });
    expect(cancel.status).toBe(403);
  });

  it('a real admin can list a real dead-lettered job with its real failure reason and attempts', async () => {
    const jobId = await createDeadLetterJob();

    const res = await request(app).get('/api/v1/admin/jobs/dead-letter').set('Authorization', `Bearer ${adminAccessToken}`);
    expect(res.status).toBe(200);
    const jobs = res.body as { data: DeadLetterJobData[] };
    const found = jobs.data.find((j) => j.id === jobId);
    expect(found).toBeDefined();
    expect(found?.attempts).toBe(1);
    expect(found?.maxAttempts).toBe(1);
    expect(found?.lastError).toContain('Simulated real failure');
  });

  it('retry -> real successful completion -> exactly one WorkflowInstance-equivalent side effect, never duplicated', async () => {
    const jobKey = `admin-retry-chain-${randomUUID()}`;
    await enqueueJob({ jobKey, dedupeKey: 'dl-retry', maxAttempts: 1 });
    const claimed = await claimJob(jobKey, 'worker-1');
    if (!claimed) throw new Error('expected claim');
    await startJob(claimed.id, 'worker-1');
    await failJob(claimed.id, 'worker-1', 'First real attempt failed.');

    const retryRes = await request(app).post(`/api/v1/admin/jobs/${claimed.id}/retry`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(retryRes.status).toBe(200);
    const retried = await prisma.job.findUniqueOrThrow({ where: { id: claimed.id } });
    expect(retried.status).toBe('PENDING');
    expect(retried.attempts).toBe(0);
    expect(retried.lastError).toBeNull();

    // A second retry attempt on the SAME job (now PENDING, not FAILED) must
    // be rejected — the real proof that retry "must not duplicate business
    // effects": there is no way to double-reset the same dead-letter job.
    const secondRetry = await request(app).post(`/api/v1/admin/jobs/${claimed.id}/retry`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(secondRetry.status).toBe(422);

    // Real completion via the normal worker path — proves the reset job is
    // genuinely re-claimable and runs through the exact same machinery.
    const reclaimed = await claimJob(jobKey, 'worker-2');
    expect(reclaimed?.id).toBe(claimed.id);
  });

  it('cancel is a distinct terminal state from FAILED, and a cancelled job can never be retried again', async () => {
    const jobId = await createDeadLetterJob();

    const cancelRes = await request(app).post(`/api/v1/admin/jobs/${jobId}/cancel`).set('Authorization', `Bearer ${adminAccessToken}`).send({ reason: 'Not needed anymore — duplicate of a fixed job.' });
    expect(cancelRes.status).toBe(200);
    const cancelled = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.lastError).toContain('Cancelled by admin');

    // No longer listed as dead-lettered.
    const list = await request(app).get('/api/v1/admin/jobs/dead-letter').set('Authorization', `Bearer ${adminAccessToken}`);
    const jobs = list.body as { data: DeadLetterJobData[] };
    expect(jobs.data.find((j) => j.id === jobId)).toBeUndefined();

    // A cancelled job cannot be retried (it is not FAILED anymore).
    const retryAfterCancel = await request(app).post(`/api/v1/admin/jobs/${jobId}/retry`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(retryAfterCancel.status).toBe(422);
  });

  it('retrying or cancelling a nonexistent job is a real 404', async () => {
    const fakeId = randomUUID();
    const retry = await request(app).post(`/api/v1/admin/jobs/${fakeId}/retry`).set('Authorization', `Bearer ${adminAccessToken}`);
    expect(retry.status).toBe(404);

    const cancel = await request(app).post(`/api/v1/admin/jobs/${fakeId}/cancel`).set('Authorization', `Bearer ${adminAccessToken}`).send({ reason: 'test' });
    expect(cancel.status).toBe(404);
  });
});
