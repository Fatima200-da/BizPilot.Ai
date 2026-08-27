import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { tickScheduler, registerScheduledWorkflowHandler, SCHEDULED_WORKFLOW_JOB_KEY } from './scheduler-tick.service';
import { runWorkerTick, claimJob, startJob, completeJob } from './job-queue.service';

/**
 * Phase 28 Track A Sections 3, 4, 6: real end-to-end scheduler->queue->
 * worker->workflow execution, real concurrent-tick duplicate prevention
 * (MANDATORY, proven against real PostgreSQL), and missed-job recovery
 * (coalescing) after simulated downtime.
 *
 * Real defect found via real execution during this phase (test-isolation,
 * not application, defect): unlike job-queue.integration.test.ts (Phase
 * 27), which gives every test its own randomUUID-suffixed jobKey, these
 * tests all legitimately share ONE fixed jobKey — `scheduled-workflow-run`
 * — because that IS the real, single production job type every scheduled
 * workflow occurrence enqueues into (this is intentional, not a shortcut:
 * a real deployment has exactly one such queue, not one per schedule).
 * Without cleanup, a `runWorkerTick` call in one test can claim a stale,
 * orphaned Job row left behind by an earlier test run whose
 * ScheduledWorkflow (and therefore workspace) was already deleted — the
 * real handler then correctly throws "ScheduledWorkflow ... no longer
 * exists" and the job correctly goes to RETRY_WAIT, which is CORRECT
 * production behavior for a genuinely orphaned job, but made these tests
 * cross-contaminate each other. Fixed by clearing this jobKey's queue
 * before every test, exactly the outcome `cleanupTestUser` already
 * provides for every OTHER table via cascading foreign keys — `Job` has
 * none by design (Phase 27: jobs are platform-level, not tenant-scoped),
 * so it needs this explicit sweep instead.
 */
describe('Scheduler tick (integration, real PostgreSQL)', () => {
  beforeAll(async () => {
    await ensureSeeded();
    registerScheduledWorkflowHandler();
  });

  beforeEach(async () => {
    await prisma.job.deleteMany({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY } });
  });

  async function createDueSchedule(intervalUnit: 'MINUTE' | 'HOUR' = 'HOUR', intervalValue = 1): Promise<{
    ownerEmail: string;
    workspaceId: string;
    scheduledWorkflowId: string;
  }> {
    const owner = await registerTestUser('Scheduler Tick Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduler Tick Workspace');

    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ name: 'Scheduler Tick Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    const businessProfileId = (profileRes.body as { data: { id: string } }).data.id;

    const scheduled = await prisma.scheduledWorkflow.create({
      data: {
        workspaceId: ws.workspaceId,
        workflowDefinitionKey: 'marketing-autopilot',
        businessProfileId,
        name: 'Test due schedule',
        intervalUnit,
        intervalValue,
        timezone: 'UTC',
        nextRunAt: new Date(Date.now() - 1000), // already due
      },
    });

    return { ownerEmail: owner.email, workspaceId: ws.workspaceId, scheduledWorkflowId: scheduled.id };
  }

  // Phase 28's sixth confirmed PGlite-vs-real-Postgres divergence — the
  // same DateTime round-trip bug documented in Phase 27
  // (job-queue.integration.test.ts) and re-confirmed here via a standalone
  // probe: writing `new Date()` and reading it back under PGlite returns a
  // value shifted by exactly this environment's local UTC offset
  // (-14400000ms / -240min, matching `Date.getTimezoneOffset()` exactly).
  // `createDueSchedule` above writes `nextRunAt` as `Date.now() - 1000`
  // directly (not through a JS-side read-then-compare, but the STORED
  // value itself is what gets corrupted on write under PGlite), which
  // makes the subsequent `nextRunAt <= now` due-check unreliable for this
  // specific row under PGlite only. The underlying `tickScheduler`/CAS
  // logic is proven correct against real Postgres (this exact test passes
  // 100% there, 3/3 repeated MANDATORY-test runs below). Real PostgreSQL
  // is authoritative for this phase's scheduler certification.
  const runsAgainstPgliteDateBug = process.env.USE_PGLITE_ADAPTER === 'true';
  const itRealPostgresOnlyDateBug = runsAgainstPgliteDateBug ? it.skip : it;

  itRealPostgresOnlyDateBug('end-to-end: a real scheduler tick creates a real Job, a real worker claims and executes it, and a real WorkflowInstance completes (real PostgreSQL only — see comment above)', async () => {
    const { ownerEmail, workspaceId, scheduledWorkflowId } = await createDueSchedule();

    const tick = await tickScheduler();
    expect(tick.claimedCount).toBeGreaterThanOrEqual(1);
    expect(tick.enqueuedCount).toBeGreaterThanOrEqual(1);

    const workerResult = await runWorkerTick(SCHEDULED_WORKFLOW_JOB_KEY, 'test-worker-1');
    expect(workerResult.claimed).toBe(true);
    expect(workerResult.outcome).toBe('SUCCEEDED');

    const instances = await prisma.workflowInstance.findMany({ where: { workspaceId } });
    expect(instances.length).toBeGreaterThanOrEqual(1);
    expect(instances.some((i) => i.status === 'COMPLETED' || i.status === 'AWAITING_APPROVAL')).toBe(true); // marketing-autopilot's real gate, not a stub

    // Phase 29: a real, distinct SCHEDULED_WORKFLOW_COMPLETED notification
    // fired for this real run (never gated on literal COMPLETED only —
    // marketing-autopilot's real approval gate means AWAITING_APPROVAL is
    // the common real outcome here).
    const notification = await prisma.notification.findFirst({ where: { workspaceId, type: 'SCHEDULED_WORKFLOW_COMPLETED' } });
    expect(notification).not.toBeNull();

    // nextRunAt advanced to a real future instant — this occurrence is done.
    const schedule = await prisma.scheduledWorkflow.findUniqueOrThrow({ where: { id: scheduledWorkflowId } });
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    expect(schedule.lastRunAt).not.toBeNull();

    await cleanupTestUser(ownerEmail);
  }, 30_000);

  // Gated real-Postgres-only for two independent, compounding reasons:
  // (1) it is the MANDATORY concurrency proof Section 6 explicitly requires
  // ("Prove this with real concurrent PostgreSQL execution"), matching
  // every other MANDATORY concurrency test in this project since Phase 25;
  // (2) `createDueSchedule` is also subject to the DateTime round-trip bug
  // documented above `itRealPostgresOnlyDateBug`.
  const runsAgainstPglite = process.env.USE_PGLITE_ADAPTER === 'true';
  const itRealPostgresOnly = runsAgainstPglite ? it.skip : it;

  itRealPostgresOnly('MANDATORY: 5 concurrent scheduler ticks against the SAME due schedule result in exactly one claimed occurrence and exactly one enqueued Job (real PostgreSQL only)', async () => {
    const { ownerEmail, scheduledWorkflowId } = await createDueSchedule();

    const results = await Promise.all(Array.from({ length: 5 }, () => tickScheduler()));

    const totalClaimed = results.reduce((sum, r) => sum + r.claimedCount, 0);
    expect(totalClaimed).toBe(1); // exactly one of the 5 concurrent ticks won the CAS

    const jobCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduledWorkflowId}:` } } });
    expect(jobCount).toBe(1); // real Postgres unique-constraint proof, not just the returned promises

    await cleanupTestUser(ownerEmail);
  });

  itRealPostgresOnlyDateBug('missed-job recovery: a schedule with a far-past nextRunAt (simulated long downtime) fires exactly ONE catch-up run and coalesces straight to a future occurrence, never replaying every missed tick (real PostgreSQL only — see comment above)', async () => {
    const { ownerEmail, workspaceId, scheduledWorkflowId } = await createDueSchedule('MINUTE', 5);

    // Simulate a real, long downtime: back-date nextRunAt by 3 days for a
    // 5-minute-interval schedule — that's ~864 missed occurrences.
    await prisma.scheduledWorkflow.update({ where: { id: scheduledWorkflowId }, data: { nextRunAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });

    const tick = await tickScheduler();
    expect(tick.claimedCount).toBe(1); // exactly one real occurrence is claimed/run for the whole missed window
    expect(tick.coalescedCount).toBeGreaterThan(800); // real proof the ~864 missed occurrences were coalesced, not individually replayed

    const jobCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduledWorkflowId}:` } } });
    expect(jobCount).toBe(1); // exactly one real Job — not 864

    const schedule = await prisma.scheduledWorkflow.findUniqueOrThrow({ where: { id: scheduledWorkflowId } });
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(Date.now()); // caught up to a genuine future slot

    await cleanupTestUser(ownerEmail);
    void workspaceId;
  });

  it('a disabled schedule is never picked up by a tick, even when its nextRunAt is due', async () => {
    const { ownerEmail, scheduledWorkflowId } = await createDueSchedule();
    await prisma.scheduledWorkflow.update({ where: { id: scheduledWorkflowId }, data: { enabled: false } });

    const beforeCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduledWorkflowId}:` } } });
    await tickScheduler();
    const afterCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduledWorkflowId}:` } } });
    expect(afterCount).toBe(beforeCount); // no new job for a disabled schedule

    await cleanupTestUser(ownerEmail);
  });

  it('a schedule not yet due (nextRunAt in the future) is never picked up early', async () => {
    const owner = await registerTestUser('Scheduler Tick Future Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduler Tick Future Workspace');
    const scheduled = await prisma.scheduledWorkflow.create({
      data: {
        workspaceId: ws.workspaceId,
        workflowDefinitionKey: 'marketing-autopilot',
        name: 'Future schedule',
        intervalUnit: 'HOUR',
        intervalValue: 1,
        timezone: 'UTC',
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
      },
    });

    await tickScheduler();
    const jobCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduled.id}:` } } });
    expect(jobCount).toBe(0);

    await cleanupTestUser(owner.email);
  });

  describe('failure injection (Section 9)', () => {
    itRealPostgresOnlyDateBug('worker crash: a scheduled-workflow-run job claimed by a worker that then "crashes" (lease expires) is reclaimed and completed by a different worker, with the crashed worker unable to complete it (real PostgreSQL only — see comment above)', async () => {
      const { ownerEmail, scheduledWorkflowId } = await createDueSchedule();
      await tickScheduler();

      const claimedByCrashedWorkerOrNull = await claimJob(SCHEDULED_WORKFLOW_JOB_KEY, 'worker-about-to-crash', 30_000);
      if (!claimedByCrashedWorkerOrNull) throw new Error('expected initial claim to succeed');
      const claimedByCrashedWorker = claimedByCrashedWorkerOrNull;
      await startJob(claimedByCrashedWorker.id, 'worker-about-to-crash');

      // Simulate the crash: the lease expires without ever completing.
      await prisma.job.update({ where: { id: claimedByCrashedWorker.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });

      const result = await runWorkerTick(SCHEDULED_WORKFLOW_JOB_KEY, 'worker-B-recovering');
      expect(result.claimed).toBe(true);
      expect(result.jobId).toBe(claimedByCrashedWorker.id); // the SAME job, reclaimed — not a duplicate
      expect(result.outcome).toBe('SUCCEEDED');

      // The crashed worker can never complete a job it no longer owns the lease for.
      const staleComplete = await completeJob(claimedByCrashedWorker.id, 'worker-about-to-crash');
      expect(staleComplete).toBe(false);

      // Exactly one real WorkflowInstance resulted — the crash + recovery never duplicated business execution.
      const schedule = await prisma.scheduledWorkflow.findUniqueOrThrow({ where: { id: scheduledWorkflowId } });
      const instances = await prisma.workflowInstance.count({ where: { workspaceId: schedule.workspaceId } });
      expect(instances).toBe(1);

      await cleanupTestUser(ownerEmail);
    }, 30_000);

    itRealPostgresOnlyDateBug('scheduler restart: calling tickScheduler again immediately after a prior tick (simulating a fresh scheduler process starting up) never re-fires the occurrence that prior tick already claimed (real PostgreSQL only — see comment above)', async () => {
      const { ownerEmail, scheduledWorkflowId } = await createDueSchedule();

      const firstTick = await tickScheduler();
      expect(firstTick.claimedCount).toBe(1);

      // A "restarted" scheduler process calling tickScheduler immediately
      // after — the schedule's nextRunAt has already advanced to a real
      // future instant, so a fresh tick call finds nothing due for it.
      const secondTick = await tickScheduler();
      expect(secondTick.dueCount).toBe(0);

      const jobCount = await prisma.job.count({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: `${scheduledWorkflowId}:` } } });
      expect(jobCount).toBe(1); // still exactly one real Job for this occurrence, never a second

      await cleanupTestUser(ownerEmail);
    });
  });
});
