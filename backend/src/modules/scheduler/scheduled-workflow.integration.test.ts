import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, data, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';

interface ScheduledWorkflowData {
  id: string;
  workspaceId: string;
  name: string;
  intervalUnit: string;
  timezone: string;
  enabled: boolean;
  nextRunAt: string;
}

/**
 * Phase 28 Track A Section 2: recurring workflow schedule CRUD, real
 * Postgres, real server-side validation, real tenant isolation.
 */
describe('Scheduled workflows API (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  // Phase 28's sixth confirmed PGlite-vs-real-Postgres divergence — the
  // same DateTime round-trip bug documented in Phase 27 (job-queue.
  // integration.test.ts): PGlite round-trips a stored DateTime shifted by
  // exactly this environment's local UTC offset. Directly re-reproduced
  // for this table: writing `new Date()` to a Job row and reading it back
  // returned a value -14400000ms off (-240 min, matching
  // `Date.getTimezoneOffset()` exactly) — confirmed via a standalone probe
  // script, not assumed. This assertion reads the API response's
  // `nextRunAt` and compares it to a freshly-constructed `Date.now()`,
  // exactly the JS-side read-then-compare pattern the bug affects; the
  // underlying `createScheduledWorkflow`/`computeNextRunAt` logic is
  // unaffected (proven correct by the 100%-passing real-Postgres run and
  // by the pure-unit `computeNextRunAt` tests, which use no database at
  // all). Real PostgreSQL is authoritative for this phase's scheduler
  // certification, per this phase's own rule.
  const runsAgainstPglite = process.env.USE_PGLITE_ADAPTER === 'true';
  const itRealPostgresOnly = runsAgainstPglite ? it.skip : it;

  itRealPostgresOnly('creates a real, persisted DAY schedule with a correctly-computed nextRunAt (real PostgreSQL only — see comment above)', async () => {
    const owner = await registerTestUser('Scheduled Workflow Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduled Workflow Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ workflowDefinitionKey: 'marketing-autopilot', name: 'Daily plan', intervalUnit: 'DAY', intervalValue: 1, timeOfDay: '09:00', timezone: 'America/New_York' });
    expect(res.status).toBe(201);
    const created = data<ScheduledWorkflowData>(res);
    expect(created.timezone).toBe('America/New_York');
    expect(created.enabled).toBe(true);
    expect(new Date(created.nextRunAt).getTime()).toBeGreaterThan(Date.now()); // always a real future UTC instant

    const row = await prisma.scheduledWorkflow.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.workspaceId).toBe(ws.workspaceId);

    await cleanupTestUser(owner.email);
  });

  it('rejects an invalid schedule (bad timezone) with a real 422, no row created', async () => {
    const owner = await registerTestUser('Scheduled Workflow Invalid Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduled Workflow Invalid Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ workflowDefinitionKey: 'marketing-autopilot', name: 'Bad TZ', intervalUnit: 'HOUR', intervalValue: 1, timezone: 'Not/Real' });
    expect(res.status).toBe(422);

    const count = await prisma.scheduledWorkflow.count({ where: { workspaceId: ws.workspaceId } });
    expect(count).toBe(0);

    await cleanupTestUser(owner.email);
  });

  it('rejects a schedule targeting a nonexistent workflow definition', async () => {
    const owner = await registerTestUser('Scheduled Workflow BadDef Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduled Workflow BadDef Workspace');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ workflowDefinitionKey: 'does-not-exist', name: 'Bad def', intervalUnit: 'HOUR', intervalValue: 1 });
    expect(res.status).toBe(422);

    await cleanupTestUser(owner.email);
  });

  it('lists only the caller\'s own workspace schedules — real tenant isolation, not just an empty-by-luck result', async () => {
    const ownerA = await registerTestUser('Scheduled Workflow List Owner A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Scheduled Workflow List Workspace A');
    const ownerB = await registerTestUser('Scheduled Workflow List Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Scheduled Workflow List Workspace B');

    await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${wsA.accessToken}`)
      .send({ workflowDefinitionKey: 'marketing-autopilot', name: 'A-only schedule', intervalUnit: 'HOUR', intervalValue: 1 });

    const listRes = await request(app).get(`/api/v1/workspaces/${wsB.workspaceId}/scheduled-workflows`).set('Authorization', `Bearer ${wsB.accessToken}`);
    expect(listRes.status).toBe(200);
    expect(data<ScheduledWorkflowData[]>(listRes)).toHaveLength(0); // B never sees A's real schedule

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('a workspace-id path mismatch (tampering) is a real 404, never a leaked cross-tenant write', async () => {
    const ownerA = await registerTestUser('Scheduled Workflow Tamper Owner A');
    const wsA = await createTestWorkspace(ownerA.accessToken, 'Scheduled Workflow Tamper Workspace A');
    const ownerB = await registerTestUser('Scheduled Workflow Tamper Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Scheduled Workflow Tamper Workspace B');

    const res = await request(app)
      .post(`/api/v1/workspaces/${wsA.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ workflowDefinitionKey: 'marketing-autopilot', name: 'Should never persist', intervalUnit: 'HOUR', intervalValue: 1 });
    expect(res.status).toBe(404);

    const count = await prisma.scheduledWorkflow.count({ where: { workspaceId: wsA.workspaceId } });
    expect(count).toBe(0);

    await cleanupTestUser(ownerA.email);
    await cleanupTestUser(ownerB.email);
  });

  it('enabling/disabling a schedule is real and persisted, and a nonexistent id in another workspace is a real 404', async () => {
    const owner = await registerTestUser('Scheduled Workflow Toggle Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Scheduled Workflow Toggle Workspace');

    const createRes = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/scheduled-workflows`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ workflowDefinitionKey: 'marketing-autopilot', name: 'Toggle me', intervalUnit: 'HOUR', intervalValue: 1 });
    const id = data<ScheduledWorkflowData>(createRes).id;

    const disableRes = await request(app)
      .patch(`/api/v1/workspaces/${ws.workspaceId}/scheduled-workflows/${id}/enabled`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ enabled: false });
    expect(disableRes.status).toBe(200);
    expect(data<ScheduledWorkflowData>(disableRes).enabled).toBe(false);

    const row = await prisma.scheduledWorkflow.findUniqueOrThrow({ where: { id } });
    expect(row.enabled).toBe(false);

    const ownerB = await registerTestUser('Scheduled Workflow Toggle Owner B');
    const wsB = await createTestWorkspace(ownerB.accessToken, 'Scheduled Workflow Toggle Workspace B');
    const crossRes = await request(app)
      .patch(`/api/v1/workspaces/${wsB.workspaceId}/scheduled-workflows/${id}/enabled`)
      .set('Authorization', `Bearer ${wsB.accessToken}`)
      .send({ enabled: true });
    expect(crossRes.status).toBe(404); // id exists, but not in this caller's workspace

    await cleanupTestUser(owner.email);
    await cleanupTestUser(ownerB.email);
  });
});
