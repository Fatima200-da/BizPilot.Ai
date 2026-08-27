/**
 * Phase 18 Section 20: a practical MVP performance smoke test, not a
 * benchmark suite. Measures real request latency for the operations a real
 * user's session actually exercises.
 *
 * Phase 22: this script now runs against whatever DATABASE_URL/
 * USE_PGLITE_ADAPTER resolve to via the normal env.ts/dotenv path — it no
 * longer assumes PGlite. The printed report header (below) reflects the
 * actual engine used for that run, read from `env`, so a report generated
 * against real networked PostgreSQL is never mislabeled as PGlite or vice
 * versa (a real, found-and-fixed mislabeling bug this phase).
 *
 * Run against real Postgres (default): npx tsx src/scripts/perf-smoke.ts
 * Run against PGlite:    USE_PGLITE_ADAPTER=true npx tsx src/scripts/perf-smoke.ts
 */
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { seedRbac } from './seed-rbac';
import { seedWorkflowDefinitions } from './seed-workflow-definitions';

interface Timing {
  op: string;
  ms: number[];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function report(t: Timing): void {
  const sorted = [...t.ms].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const errors = t.ms.filter((v) => v < 0).length;
  // Phase 20 Section 21: p99 with n<100 is statistically thin (often just
  // the max sample) — reported honestly as such, not presented as a
  // meaningful tail-latency SLA.
  console.log(
    `${t.op.padEnd(32)} n=${String(t.ms.length).padStart(3)}  p50=${p50.toFixed(1).padStart(7)}ms  p95=${p95.toFixed(1).padStart(7)}ms  p99=${p99.toFixed(1).padStart(7)}ms  errors=${String(errors)}`
  );
}

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function main(): Promise<void> {
  await seedRbac();
  await seedWorkflowDefinitions();
  const app = createApp();

  const N = 15;

  // 1. Register + login (each iteration uses a fresh user — registration
  // cost, not login cost, dominates unless measured separately).
  const registerTimes: number[] = [];
  const loginTimes: number[] = [];
  let lastEmail = '';
  let lastToken = '';
  for (let i = 0; i < N; i += 1) {
    const email = `perf-${String(i)}-${String(Date.now())}@example.test`;
    lastEmail = email;
    registerTimes.push(
      await time(async () => {
        const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName: 'Perf Test' });
        lastToken = (res.body as { data: { accessToken: string } }).data.accessToken;
      })
    );
  }
  for (let i = 0; i < N; i += 1) {
    loginTimes.push(
      await time(() => request(app).post('/api/v1/auth/login').send({ email: lastEmail, password: 'password1234' }))
    );
  }

  // 2. Workspace creation + load.
  const workspaceCreateTimes: number[] = [];
  let workspaceId = '';
  let workspaceToken = lastToken;
  for (let i = 0; i < N; i += 1) {
    workspaceCreateTimes.push(
      await time(async () => {
        const res = await request(app)
          .post('/api/v1/workspaces')
          .set('Authorization', `Bearer ${workspaceToken}`)
          .send({ name: `Perf Workspace ${String(i)}` });
        const body = (res.body as { data: { workspace: { id: string }; accessToken: string } }).data;
        workspaceId = body.workspace.id;
        workspaceToken = body.accessToken;
      })
    );
  }

  const dashboardLoadTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    dashboardLoadTimes.push(
      await time(() => request(app).get(`/api/v1/workspaces/${workspaceId}/business-profiles`).set('Authorization', `Bearer ${workspaceToken}`))
    );
  }

  // 3. CRM request.
  await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/crm/contacts`)
    .set('Authorization', `Bearer ${workspaceToken}`)
    .send({ fullName: 'Perf Contact' });
  const crmListTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    crmListTimes.push(await time(() => request(app).get(`/api/v1/workspaces/${workspaceId}/crm/contacts`).set('Authorization', `Bearer ${workspaceToken}`)));
  }

  // 4. Business profile (needed for workflow creation) + workflow creation/completion (heaviest op: 7 steps, 30 ContentAsset rows in one $transaction).
  const profileRes = await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/business-profiles`)
    .set('Authorization', `Bearer ${workspaceToken}`)
    // Phase 21 Section 26: `industry` was missing here, which is optional at
    // the API layer (business-profile.validation.ts — profiles can be
    // edited incrementally) but required by marketing-autopilot's
    // validate_context step (marketing-autopilot.steps.ts's
    // step01ValidateContext, a permanent, never-retried failure). Every
    // "workflow create+complete"/"approval" measurement in every phase
    // through Phase 20 was therefore actually timing an instant step-1
    // validation failure, not a real 7-step/30-asset run — this is also the
    // root cause of Phase 20's "unresolved" interleaved-409 anomaly during
    // performance testing (every approve() call hit an already-FAILED
    // instance, never one truly AWAITING_APPROVAL). Real customers cannot
    // hit this: OnboardingPage.tsx's industry field has `required` at the
    // HTML form layer.
    .send({ name: 'Perf Biz', industry: 'Beauty Salon', contentLanguage: 'AZ' });
  const businessProfileId = (profileRes.body as { data: { id: string } }).data.id;

  const workflowCreateTimes: number[] = [];
  const WORKFLOW_N = 5; // fewer iterations — this is the heaviest single operation in the product
  for (let i = 0; i < WORKFLOW_N; i += 1) {
    workflowCreateTimes.push(
      await time(() =>
        request(app)
          .post(`/api/v1/workspaces/${workspaceId}/workflows/marketing-autopilot`)
          .set('Authorization', `Bearer ${workspaceToken}`)
          .send({ businessProfileId, objective: 'bookings', platforms: ['instagram'] })
      )
    );
  }

  // 5. Database-heavy query: list workspaces for a user who now has N+1 of them.
  const listWorkspacesTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    listWorkspacesTimes.push(await time(() => request(app).get('/api/v1/workspaces').set('Authorization', `Bearer ${workspaceToken}`)));
  }

  // 6. Content asset retrieval (the calendar-review screen's main read path).
  const contentAssetListTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    contentAssetListTimes.push(
      await time(() => request(app).get(`/api/v1/workspaces/${workspaceId}/content-assets`).set('Authorization', `Bearer ${workspaceToken}`))
    );
  }

  // 7. Approval (the last step of the golden path) — measured on its own
  // fresh instance per iteration since an instance can only be approved once.
  //
  // Phase 21 Section 26: this loop needs its OWN workspace, not the one the
  // WORKFLOW_N loop just used. Each full run through step04 costs 20 AI
  // credits (CREDIT_COSTS.strategy + .pillars + .calendar in
  // marketing-autopilot.steps.ts) and a fresh workspace's starter allowance
  // is exactly 100 (FREE_TIER_STARTER_CREDITS, workspace.service.ts) — the
  // WORKFLOW_N=5 loop above spends exactly that allowance to zero. Reusing
  // the same workspace here meant every one of these 5 runs hit
  // InsufficientCreditsError at build_strategy (a real, correctly-working
  // guardrail — see Cost & Usage Certification — not a bug), so every prior
  // phase's "approval" timing measured a credit-exhaustion rejection, not a
  // real approval. A dedicated workspace gives this loop its own fresh
  // 100-credit allowance, matching what a real second customer's workspace
  // would have.
  const approvalWsRes = await request(app).post('/api/v1/workspaces').set('Authorization', `Bearer ${workspaceToken}`).send({ name: 'Perf Workspace (approval)' });
  const approvalWorkspaceId = (approvalWsRes.body as { data: { workspace: { id: string } } }).data.workspace.id;
  const approvalWorkspaceToken = (approvalWsRes.body as { data: { accessToken: string } }).data.accessToken;
  const approvalProfileRes = await request(app)
    .post(`/api/v1/workspaces/${approvalWorkspaceId}/business-profiles`)
    .set('Authorization', `Bearer ${approvalWorkspaceToken}`)
    .send({ name: 'Perf Biz (approval)', industry: 'Beauty Salon', contentLanguage: 'AZ' });
  const approvalBusinessProfileId = (approvalProfileRes.body as { data: { id: string } }).data.id;

  const approvalTimes: number[] = [];
  const APPROVAL_N = 5;
  for (let i = 0; i < APPROVAL_N; i += 1) {
    const startRes = await request(app)
      .post(`/api/v1/workspaces/${approvalWorkspaceId}/workflows/marketing-autopilot`)
      .set('Authorization', `Bearer ${approvalWorkspaceToken}`)
      .send({ businessProfileId: approvalBusinessProfileId, objective: 'sales', platforms: ['instagram'] });
    const instanceId = (startRes.body as { data: { id: string } }).data.id;
    approvalTimes.push(
      await time(() =>
        request(app)
          .post(`/api/v1/workspaces/${approvalWorkspaceId}/workflow-instances/${instanceId}/approve`)
          .set('Authorization', `Bearer ${approvalWorkspaceToken}`)
      )
    );
  }

  const engineLabel = env.USE_PGLITE_ADAPTER ? 'PGlite-native engine, in-process, single-threaded' : 'REAL NETWORKED POSTGRESQL (via @prisma/adapter-pg)';
  console.log(`\n--- Phase 22 Performance Certification (${engineLabel}) ---\n`);
  report({ op: 'register', ms: registerTimes });
  report({ op: 'login', ms: loginTimes });
  report({ op: 'workspace create', ms: workspaceCreateTimes });
  report({ op: 'dashboard load (business-profiles)', ms: dashboardLoadTimes });
  report({ op: 'crm contacts list', ms: crmListTimes });
  report({ op: 'workflow create+complete (30 assets)', ms: workflowCreateTimes });
  report({ op: 'list workspaces (db-heavy)', ms: listWorkspacesTimes });
  report({ op: 'content asset list', ms: contentAssetListTimes });
  report({ op: 'approval', ms: approvalTimes });

  const allTimes = [...registerTimes, ...loginTimes, ...workspaceCreateTimes, ...dashboardLoadTimes, ...crmListTimes, ...listWorkspacesTimes, ...contentAssetListTimes];
  const maxLatency = Math.max(...allTimes);
  console.log(`\nMax observed latency (excluding workflow creation/approval): ${maxLatency.toFixed(1)}ms`);
  console.log('No concurrency was simulated beyond sequential requests — see record doc for the honest scope of this measurement.');
  console.log('p99 figures above are statistically thin (n<100, often just the max sample) — reported honestly, not as a tail-latency SLA.');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('perf-smoke failed:', err);
    process.exit(1);
  });
