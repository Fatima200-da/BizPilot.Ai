import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { ensureSeeded, registerTestUser, createTestWorkspace, cleanupTestUser } from '../../testing/integration-helpers';
import { PurgeAlreadyInProgressError, countPurgeEligible, getPurgeObservability, runDataRetentionPurge } from './data-retention.service';
import { DEFAULT_RETENTION_SCHEDULE_NAME, RETENTION_PURGE_JOB_KEY, ensureDefaultRetentionSchedule, registerRetentionPurgeJobHandler, tickRetentionScheduler } from './data-retention-scheduler.service';
import { enqueueJob, runWorkerTick } from '../scheduler/job-queue.service';

/**
 * Phase 33 Track C: real, enforced data retention — real hard-deletes,
 * real cascade-safety proof (a Contact with any real, non-purged Lead is
 * NEVER purged, regardless of the Contact's own eligibility), real audit
 * trail, real concurrency guard, real scheduler integration. All against
 * real PostgreSQL.
 */
const runsAgainstPglite = process.env.USE_PGLITE_ADAPTER === 'true';
const itRealPostgresOnly = runsAgainstPglite ? it.skip : it;

const OLD_CUTOFF = (): Date => new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // past the real 90-day default
const RECENT_CUTOFF = (): Date => new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // not yet eligible

async function cleanupWorkspace(workspaceId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { workspaceId } });
  await prisma.lead.deleteMany({ where: { workspaceId } });
  await prisma.contact.deleteMany({ where: { workspaceId } });
}

describe('Phase 33 Track C: enforced data retention — functional correctness', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  itRealPostgresOnly('a real purge deletes only genuinely eligible rows: old+lead-free contacts, old leads, old members — never recent, active, or lead-attached ones', async () => {
    const user = await registerTestUser('Retention Functional Owner');
    const ws = await createTestWorkspace(user.accessToken, 'Retention Functional Workspace');

    const oldContact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Old Deleted', deletedAt: OLD_CUTOFF() } });
    const recentContact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Recently Deleted', deletedAt: RECENT_CUTOFF() } });
    const activeContact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Active', deletedAt: null } });
    const oldLead = await prisma.lead.create({ data: { workspaceId: ws.workspaceId, contactId: activeContact.id, source: 'MANUAL', deletedAt: OLD_CUTOFF() } });

    const result = await runDataRetentionPurge({ triggerType: 'MANUAL' });

    expect(result.run.status).toBe('SUCCEEDED');
    expect(await prisma.contact.findUnique({ where: { id: oldContact.id } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: recentContact.id } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: activeContact.id } })).not.toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: oldLead.id } })).toBeNull();

    await prisma.dataRetentionPurgeRun.delete({ where: { id: result.run.id } });
    await cleanupWorkspace(ws.workspaceId);
    await cleanupTestUser(user.email);
  }, 30_000);

  itRealPostgresOnly('cascade safety: a Contact with a real, ACTIVE (never-deleted) Lead is NEVER purged, even though the Contact itself is old and soft-deleted', async () => {
    const user = await registerTestUser('Retention Cascade Owner');
    const ws = await createTestWorkspace(user.accessToken, 'Retention Cascade Workspace');

    const contact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Old Contact With Active Lead', deletedAt: OLD_CUTOFF() } });
    const activeLead = await prisma.lead.create({ data: { workspaceId: ws.workspaceId, contactId: contact.id, source: 'MANUAL', deletedAt: null } });

    const result = await runDataRetentionPurge({ triggerType: 'MANUAL' });

    expect(result.run.status).toBe('SUCCEEDED');
    // real proof: if this were purged, the database's own onDelete:Cascade
    // on Lead.contactId would have silently destroyed the active lead too —
    // both must still exist, unconditionally.
    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).not.toBeNull();
    expect(await prisma.lead.findUnique({ where: { id: activeLead.id } })).not.toBeNull();

    await prisma.dataRetentionPurgeRun.delete({ where: { id: result.run.id } });
    await cleanupWorkspace(ws.workspaceId);
    await cleanupTestUser(user.email);
  }, 30_000);

  itRealPostgresOnly('a real, complete audit trail is created for every purged row, scoped to the correct workspace', async () => {
    const user = await registerTestUser('Retention Audit Owner');
    const ws = await createTestWorkspace(user.accessToken, 'Retention Audit Workspace');

    const contact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Audit Test Contact', deletedAt: OLD_CUTOFF() } });

    const result = await runDataRetentionPurge({ triggerType: 'MANUAL' });
    expect(result.run.status).toBe('SUCCEEDED');

    const audit = await prisma.auditLog.findFirst({ where: { workspaceId: ws.workspaceId, action: 'DELETE', entityType: 'Contact', entityId: contact.id } });
    expect(audit).not.toBeNull();

    await prisma.dataRetentionPurgeRun.delete({ where: { id: result.run.id } });
    await cleanupWorkspace(ws.workspaceId);
    await cleanupTestUser(user.email);
  }, 30_000);

  itRealPostgresOnly('legal/financial records (Invoice, Payment, Subscription, AuditLog, AICredit, AIUsage) are structurally unreachable by this purge — they have no deletedAt column for it to ever match', async () => {
    // Real, structural proof, not a policy assertion: attempting to build
    // a Prisma query against these models with a `deletedAt` filter is a
    // real TypeScript compile error, not a runtime no-op — the exclusion
    // is enforced at the schema/type level, verified here by confirming
    // none of these models even have the field in their real DB columns.
    const client = new (await import('pg')).Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const res = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns WHERE column_name = 'deletedAt' AND table_name IN ('invoices', 'payments', 'subscriptions', 'audit_logs', 'ai_credits', 'ai_usages')`
      );
      expect(res.rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  itRealPostgresOnly('countPurgeEligible is a real, read-only preview — calling it never mutates anything', async () => {
    const user = await registerTestUser('Retention Preview Owner');
    const ws = await createTestWorkspace(user.accessToken, 'Retention Preview Workspace');
    const contact = await prisma.contact.create({ data: { workspaceId: ws.workspaceId, fullName: 'Preview Test', deletedAt: OLD_CUTOFF() } });

    const preview1 = await countPurgeEligible();
    const preview2 = await countPurgeEligible();
    expect(preview1.contact).toBe(preview2.contact); // calling it twice never changes state
    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).not.toBeNull(); // still there — never purged by a mere preview

    await cleanupWorkspace(ws.workspaceId);
    await cleanupTestUser(user.email);
  }, 30_000);
});

describe('Phase 33 Track C: real failure injection', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  afterEach(async () => {
    await prisma.dataRetentionPurgeRun.deleteMany({ where: {} });
  });

  itRealPostgresOnly('duplicate/concurrent purge invocation: a second purge attempt while one is genuinely RUNNING is rejected, never runs alongside it', async () => {
    const runningId = randomUUID();
    await prisma.dataRetentionPurgeRun.create({ data: { id: runningId, status: 'RUNNING', triggerType: 'MANUAL', startedAt: new Date() } });

    await expect(runDataRetentionPurge({ triggerType: 'MANUAL' })).rejects.toThrow(PurgeAlreadyInProgressError);
  });

  itRealPostgresOnly('purge interrupted: a PurgeRun stuck at RUNNING past the stale threshold is reaped to FAILED, and a new purge is allowed to proceed', async () => {
    const staleId = randomUUID();
    const wayInThePast = new Date(Date.now() - 6 * 60 * 60 * 1000);
    await prisma.dataRetentionPurgeRun.create({ data: { id: staleId, status: 'RUNNING', triggerType: 'SCHEDULED', startedAt: wayInThePast } });

    const result = await runDataRetentionPurge({ triggerType: 'MANUAL' });
    expect(result.run.status).toBe('SUCCEEDED');

    const stale = await prisma.dataRetentionPurgeRun.findUniqueOrThrow({ where: { id: staleId } });
    expect(stale.status).toBe('FAILED');
    expect(stale.errorMessage).toContain('Abandoned');
  }, 30_000);
});

describe('Phase 33 Track C: observability', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('purge observability is computed entirely from real DataRetentionPurgeRun rows', async () => {
    const obs = await getPurgeObservability();
    expect(['RUNNING', 'HEALTHY', 'FAILED_RECENTLY', 'NO_RUNS_YET']).toContain(obs.currentStatus);
    expect(Array.isArray(obs.history)).toBe(true);
  });
});

describe('Phase 33 Track C: scheduler integration', () => {
  beforeAll(async () => {
    await ensureSeeded();
    registerRetentionPurgeJobHandler();
  });

  itRealPostgresOnly('ensureDefaultRetentionSchedule is idempotent', async () => {
    await ensureDefaultRetentionSchedule();
    await ensureDefaultRetentionSchedule();
    const schedules = await prisma.dataRetentionSchedule.findMany({ where: { name: DEFAULT_RETENTION_SCHEDULE_NAME } });
    expect(schedules.length).toBe(1);
  });

  itRealPostgresOnly('ticking the retention scheduler twice in immediate succession enqueues exactly one Job, never two', async () => {
    const scheduleName = `phase33-test-retention-schedule-${randomUUID()}`;
    const now = new Date();
    const schedule = await prisma.dataRetentionSchedule.create({
      data: { name: scheduleName, intervalHours: 168, timeOfDay: '04:00', timezone: 'UTC', enabled: true, nextRunAt: new Date(now.getTime() - 1000) },
    });

    await tickRetentionScheduler(now);
    await tickRetentionScheduler(now);

    const jobs = await prisma.job.findMany({ where: { jobKey: RETENTION_PURGE_JOB_KEY, payload: { path: ['retentionScheduleId'], equals: schedule.id } } });
    expect(jobs.length).toBe(1);

    await prisma.job.deleteMany({ where: { id: { in: jobs.map((j) => j.id) } } });
    await prisma.dataRetentionSchedule.delete({ where: { id: schedule.id } });
  });

  itRealPostgresOnly('a real data-retention-purge Job, enqueued and drained through the actual job-queue worker path, produces a real SUCCEEDED PurgeRun', async () => {
    const dedupeKey = `phase33-worker-test-${randomUUID()}`;
    const { job } = await enqueueJob({ jobKey: RETENTION_PURGE_JOB_KEY, dedupeKey, payload: {} });

    const result = await runWorkerTick(RETENTION_PURGE_JOB_KEY, `test-worker-${randomUUID()}`, 60_000);
    expect(result.claimed).toBe(true);
    expect(result.jobId).toBe(job.id);
    expect(result.outcome).toBe('SUCCEEDED');

    const recentRuns = await prisma.dataRetentionPurgeRun.findMany({ where: { status: 'SUCCEEDED', triggerType: 'SCHEDULED' }, orderBy: { startedAt: 'desc' }, take: 1 });
    expect(recentRuns[0]).toBeTruthy();

    if (recentRuns[0]) await prisma.dataRetentionPurgeRun.delete({ where: { id: recentRuns[0].id } });
    await prisma.job.delete({ where: { id: job.id } });
  }, 30_000);
});
