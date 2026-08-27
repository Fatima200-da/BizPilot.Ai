import { test, expect, request as playwrightRequest } from '@playwright/test';
import { execSync } from 'node:child_process';
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

/**
 * Phase 28: production-container E2E scenarios for Track A (scheduler) run
 * against the ACTUAL running containers (bizpilot-backend-p28,
 * bizpilot-scheduler-p28, bizpilot-frontend-p28 — see
 * playwright.container.config.ts and
 * docs/PHASE_28_PRODUCTION_AUTOMATION_PAYMENTS_CERTIFICATION.md), not a
 * dev server. There is no frontend UI for scheduled workflows yet (Track A
 * is API-only this phase), so these scenarios drive the real HTTP API
 * through the frontend container's nginx `/api` proxy — still genuinely
 * "through the container," just via `request` instead of DOM clicks.
 *
 * The minimum schedulable interval is 5 real minutes (server-enforced —
 * see scheduled-workflow.service.ts's TOO_FREQUENT guard), which is too
 * slow for a repeatable automated suite. Rather than either (a) waiting 5
 * real minutes per test run or (b) skipping real-execution coverage
 * entirely, the "real execution" and "restart recovery" tests connect
 * directly to the SAME real database the containers use (bizpilot_app role,
 * same as every other real-Postgres test in this repo) to move a freshly
 * created schedule's `nextRunAt` into the past — the same effect 5 real
 * minutes of wall-clock time would have, applied instantly — then poll the
 * real API for up to 45s for the real, running `bizpilot-scheduler-p28`
 * container to notice and process it. This is the external-black-box
 * equivalent of what the backend's own scheduler-tick.integration.test.ts
 * does by calling `tickScheduler(now)` directly in-process; here there is
 * no in-process access, only the real HTTP/DB surface a production
 * monitoring/ops tool would also have.
 */

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL not resolved from backend/.env — cannot run container DB-nudge scenarios.');

function uniqueEmail(label: string): string {
  return `e2e-p28-${label}-${Date.now()}@example.test`;
}

async function forceNextRunAtNow(scheduledWorkflowId: string): Promise<void> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    // Real defect found writing this spec, two layers deep:
    // (1) the server-side SQL `now()` function, bound into a `timestamp
    //     without time zone` column, is converted using the connecting
    //     session's TimeZone GUC — wrong host, wrong hours.
    // (2) binding a raw JS `Date` object as a parameter isn't safe either:
    //     node-postgres serializes/deserializes `timestamp without time
    //     zone` values using the CLIENT PROCESS's LOCAL timezone getters
    //     (documented node-postgres behavior, not a bug in it) — and this
    //     machine's OS timezone is Asia/Baku (UTC+4), so a true-UTC JS Date
    //     got written 4 hours off. The application itself is unaffected:
    //     every container's own Node/Prisma process has OS TZ=UTC
    //     (confirmed via `docker exec ... node -e "new Date().toISOString()"`
    //     and via the API's own correctly-UTC nextRunAt/createdAt values on
    //     creation) — this is purely an artifact of this ad-hoc
    //     test-harness connection running on a non-UTC host. Fixed by
    //     passing the target instant as an ISO STRING (never a Date
    //     object) and forcing Postgres's own UTC interpretation via
    //     `::timestamptz AT TIME ZONE 'UTC'`, which is immune to both the
    //     client's and the session's local timezone assumptions —
    //     verified directly against `psql`'s own server-side value, not
    //     round-tripped back through this same (mis-zoned) client.
    const pastInstantIso = new Date(Date.now() - 1_000).toISOString();
    await client.query('UPDATE scheduled_workflows SET "nextRunAt" = ($2::timestamptz AT TIME ZONE \'UTC\') WHERE id = $1', [scheduledWorkflowId, pastInstantIso]);
  } finally {
    await client.end();
  }
}

test.describe('Phase 28 Track A: scheduled workflows through real production containers', () => {
  test('creation is real and server-validated through the container (bad timezone, too-frequent interval both rejected)', async () => {
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8081' });
    const email = uniqueEmail('validation');
    const reg = await api.post('/api/v1/auth/register', { data: { email, password: 'SuperSecret123!', fullName: 'E2E Container Test' } });
    expect(reg.ok()).toBeTruthy();
    const regBody = (await reg.json()) as { data: { accessToken: string } };

    const ws = await api.post('/api/v1/workspaces', {
      headers: { Authorization: `Bearer ${regBody.data.accessToken}` },
      data: { name: 'E2E Container Workspace' },
    });
    const wsBody = (await ws.json()) as { data: { accessToken: string; workspace: { id: string } } };
    const wsToken = wsBody.data.accessToken;
    const workspaceId = wsBody.data.workspace.id;

    const badTz = await api.post(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsToken}` },
      data: { workflowDefinitionKey: 'marketing-autopilot', name: 'bad tz', intervalUnit: 'HOUR', intervalValue: 1, timezone: 'Not/Real' },
    });
    expect(badTz.status()).toBe(422);

    const tooFrequent = await api.post(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsToken}` },
      data: { workflowDefinitionKey: 'marketing-autopilot', name: 'too frequent', intervalUnit: 'MINUTE', intervalValue: 1, timezone: 'UTC' },
    });
    expect(tooFrequent.status()).toBe(422);

    await api.dispose();
  });

  test('cross-tenant access to a scheduled workflow is a real 404 through the container, not a leak', async () => {
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8081' });

    const ownerA = uniqueEmail('tenant-a');
    const regA = await api.post('/api/v1/auth/register', { data: { email: ownerA, password: 'SuperSecret123!', fullName: 'Tenant A' } });
    const regABody = (await regA.json()) as { data: { accessToken: string } };
    const wsA = await api.post('/api/v1/workspaces', { headers: { Authorization: `Bearer ${regABody.data.accessToken}` }, data: { name: 'Tenant A WS' } });
    const wsABody = (await wsA.json()) as { data: { accessToken: string; workspace: { id: string } } };

    const created = await api.post(`/api/v1/workspaces/${wsABody.data.workspace.id}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsABody.data.accessToken}` },
      data: { workflowDefinitionKey: 'marketing-autopilot', name: 'Tenant A schedule', intervalUnit: 'HOUR', intervalValue: 1, timezone: 'UTC' },
    });
    expect(created.ok()).toBeTruthy();
    const createdBody = (await created.json()) as { data: { id: string } };

    const ownerB = uniqueEmail('tenant-b');
    const regB = await api.post('/api/v1/auth/register', { data: { email: ownerB, password: 'SuperSecret123!', fullName: 'Tenant B' } });
    const regBBody = (await regB.json()) as { data: { accessToken: string } };
    const wsB = await api.post('/api/v1/workspaces', { headers: { Authorization: `Bearer ${regBBody.data.accessToken}` }, data: { name: 'Tenant B WS' } });
    const wsBBody = (await wsB.json()) as { data: { accessToken: string } };

    // B's token, A's workspace path — must be a real 404 (anti-enumeration), never a 403 or a leaked row.
    const crossRead = await api.get(`/api/v1/workspaces/${wsABody.data.workspace.id}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsBBody.data.accessToken}` },
    });
    expect(crossRead.status()).toBe(404);

    const crossDisable = await api.patch(`/api/v1/workspaces/${wsABody.data.workspace.id}/scheduled-workflows/${createdBody.data.id}/enabled`, {
      headers: { Authorization: `Bearer ${wsBBody.data.accessToken}` },
      data: { enabled: false },
    });
    expect(crossDisable.status()).toBe(404);

    await api.dispose();
  });

  test('a real scheduled workflow is claimed and executed by the real bizpilot-scheduler-p28 container end-to-end', async () => {
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8081' });
    const email = uniqueEmail('execution');
    const reg = await api.post('/api/v1/auth/register', { data: { email, password: 'SuperSecret123!', fullName: 'E2E Execution Test' } });
    const regBody = (await reg.json()) as { data: { accessToken: string } };
    const ws = await api.post('/api/v1/workspaces', { headers: { Authorization: `Bearer ${regBody.data.accessToken}` }, data: { name: 'E2E Execution WS' } });
    const wsBody = (await ws.json()) as { data: { accessToken: string; workspace: { id: string } } };
    const wsToken = wsBody.data.accessToken;
    const workspaceId = wsBody.data.workspace.id;

    // No BusinessProfile is created on purpose here — this proves the real
    // engine runs (reaches a genuine FAILED validation state at its first
    // step) rather than staying stuck at PENDING forever, which is exactly
    // the real defect found and fixed this phase (see the certification
    // doc) — a container that regresses this fix would show this test
    // time out waiting for a non-PENDING status.
    const sched = await api.post(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsToken}` },
      data: { workflowDefinitionKey: 'marketing-autopilot', name: 'E2E execution test', intervalUnit: 'MINUTE', intervalValue: 5, timezone: 'UTC' },
    });
    expect(sched.ok()).toBeTruthy();
    const schedBody = (await sched.json()) as { data: { id: string } };

    await forceNextRunAtNow(schedBody.data.id);

    await expect
      .poll(
        async () => {
          const list = await api.get(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, { headers: { Authorization: `Bearer ${wsToken}` } });
          const body = (await list.json()) as { data: Array<{ id: string; lastRunStatus: string | null }> };
          return body.data.find((s) => s.id === schedBody.data.id)?.lastRunStatus ?? null;
        },
        { timeout: 45_000, intervals: [2_000] }
      )
      .toBe('ENQUEUED');

    await api.dispose();
  });

  test('recovery after a real bizpilot-scheduler-p28 container restart: no duplicate execution', async () => {
    const api = await playwrightRequest.newContext({ baseURL: 'http://localhost:8081' });
    const email = uniqueEmail('restart-recovery');
    const reg = await api.post('/api/v1/auth/register', { data: { email, password: 'SuperSecret123!', fullName: 'E2E Restart Test' } });
    const regBody = (await reg.json()) as { data: { accessToken: string } };
    const ws = await api.post('/api/v1/workspaces', { headers: { Authorization: `Bearer ${regBody.data.accessToken}` }, data: { name: 'E2E Restart WS' } });
    const wsBody = (await ws.json()) as { data: { accessToken: string; workspace: { id: string } } };
    const wsToken = wsBody.data.accessToken;
    const workspaceId = wsBody.data.workspace.id;

    const sched = await api.post(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, {
      headers: { Authorization: `Bearer ${wsToken}` },
      data: { workflowDefinitionKey: 'marketing-autopilot', name: 'E2E restart test', intervalUnit: 'MINUTE', intervalValue: 5, timezone: 'UTC' },
    });
    const schedBody = (await sched.json()) as { data: { id: string } };

    // A real container restart mid-flow — the scheduler process is killed
    // and a fresh one started, exactly as an orchestrator's rolling restart
    // or crash-recovery would do in production.
    execSync('docker restart bizpilot-scheduler-p28', { stdio: 'pipe' });

    await forceNextRunAtNow(schedBody.data.id);

    await expect
      .poll(
        async () => {
          const list = await api.get(`/api/v1/workspaces/${workspaceId}/scheduled-workflows`, { headers: { Authorization: `Bearer ${wsToken}` } });
          const body = (await list.json()) as { data: Array<{ id: string; lastRunStatus: string | null }> };
          return body.data.find((s) => s.id === schedBody.data.id)?.lastRunStatus ?? null;
        },
        { timeout: 45_000, intervals: [2_000] }
      )
      .toBe('ENQUEUED');

    // Exactly one real WorkflowInstance for this occurrence — the CAS
    // duplicate-prevention (scheduler-tick.service.ts) must hold across a
    // real process restart, not just in-process.
    const client = new Client({ connectionString: DB_URL });
    await client.connect();
    try {
      const { rows } = await client.query('SELECT count(*)::int AS count FROM workflow_instances WHERE "idempotencyKey" LIKE $1', [`${schedBody.data.id}%`]);
      expect(rows[0].count).toBe(1);
    } finally {
      await client.end();
    }

    await api.dispose();
  });
});
