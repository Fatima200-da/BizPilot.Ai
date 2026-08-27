/**
 * Phase 28 Section "Performance & Stability": real p50/p95/p99 latency
 * measurement for this phase's new operations, run in-process against real
 * Postgres (same honest methodology as perf-smoke.ts — a practical smoke
 * measurement, not a formal benchmark suite; p99 with n<100 is
 * statistically thin and reported as such, never presented as an SLA).
 *
 * Run: npx tsx src/scripts/perf-phase28.ts
 */
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../infrastructure/database/prisma';
import { seedRbac } from './seed-rbac';
import { seedWorkflowDefinitions } from './seed-workflow-definitions';
import { seedSubscriptionPlans } from './seed-subscription-plans';
import { tickScheduler, SCHEDULED_WORKFLOW_JOB_KEY, registerScheduledWorkflowHandler } from '../modules/scheduler/scheduler-tick.service';
import { enqueueJob, runWorkerTick, registerJobHandler } from '../modules/scheduler/job-queue.service';
import { createScheduledWorkflow } from '../modules/scheduler/scheduled-workflow.service';
import { processWebhook } from '../modules/billing/webhook.service';
import { StripeBillingProvider } from '../modules/billing/stripe-billing-provider';
import { changePlan, getCurrentSubscription } from '../modules/billing/subscription.service';
import { getAiCreditStatus } from '../modules/billing/entitlement.service';

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
  console.log(`${t.op.padEnd(34)} n=${String(t.ms.length).padStart(3)}  p50=${p50.toFixed(1).padStart(7)}ms  p95=${p95.toFixed(1).padStart(7)}ms  p99=${p99.toFixed(1).padStart(7)}ms`);
}

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function main(): Promise<void> {
  await seedRbac();
  await seedWorkflowDefinitions();
  await seedSubscriptionPlans();
  const app = createApp();
  const N = 20;
  const runId = randomUUID().slice(0, 8);

  // Real test fixtures: one workspace to drive subscription/entitlement
  // measurements, real users/workspaces per iteration where per-tenant
  // isolation matters (scheduled workflows, webhooks).
  const reg = await request(app).post('/api/v1/auth/register').send({ email: `perf28-${runId}@example.test`, password: 'password1234', fullName: 'Perf28' });
  const regBody = reg.body as { data: { accessToken: string } };
  const wsRes = await request(app).post('/api/v1/workspaces').set('Authorization', `Bearer ${regBody.data.accessToken}`).send({ name: 'Perf28 WS' });
  const wsBody = wsRes.body as { data: { accessToken: string; workspace: { id: string } } };
  const workspaceId = wsBody.data.workspace.id;
  const wsToken = wsBody.data.accessToken;

  // --- 1. Scheduler tick (empty, steady-state — the common case: no due schedules) ---
  const tickTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    tickTimes.push(await time(() => tickScheduler()));
  }
  report({ op: 'scheduler tick (steady-state, 0 due)', ms: tickTimes });

  // --- 2. Job creation (enqueueJob) ---
  const enqueueTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    enqueueTimes.push(await time(() => enqueueJob({ jobKey: `perf28-job-${runId}`, dedupeKey: `${String(i)}-${randomUUID()}` })));
  }
  report({ op: 'job creation (enqueueJob)', ms: enqueueTimes });

  // --- 3. Job claim (runWorkerTick, real claim+handler round-trip) ---
  registerJobHandler(`perf28-job-${runId}`, async () => {
    /* no-op handler — measuring queue mechanics, not business logic */
  });
  const claimTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    claimTimes.push(await time(() => runWorkerTick(`perf28-job-${runId}`, `perf28-worker-${runId}`)));
  }
  report({ op: 'job claim + execute (runWorkerTick)', ms: claimTimes });
  await prisma.job.deleteMany({ where: { jobKey: `perf28-job-${runId}` } });

  // --- 4. Real scheduled-workflow -> workflow-engine chain (full end-to-end) ---
  registerScheduledWorkflowHandler();
  const bpRes = await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/business-profiles`)
    .set('Authorization', `Bearer ${wsToken}`)
    .send({ name: 'Perf28 Biz', industry: 'retail' });
  const bpBody = bpRes.body as { data: { id: string } };
  const chainTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const sched = await createScheduledWorkflow({
      workspaceId,
      workflowDefinitionKey: 'marketing-autopilot',
      name: `perf28-chain-${String(i)}`,
      intervalUnit: 'HOUR',
      intervalValue: 1,
      businessProfileId: bpBody.data.id,
      input: { objective: 'sales', platforms: ['instagram'] },
    });
    await prisma.scheduledWorkflow.update({ where: { id: sched.id }, data: { nextRunAt: new Date() } });
    chainTimes.push(
      await time(async () => {
        await tickScheduler();
        await runWorkerTick(SCHEDULED_WORKFLOW_JOB_KEY, `perf28-scheduler-${runId}`);
      })
    );
  }
  report({ op: 'scheduler->queue->worker->workflow (full chain)', ms: chainTimes });
  await prisma.job.deleteMany({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { contains: 'perf28-chain' } } });

  // --- 5. Webhook processing (real Stripe SDK signature verification + idempotency pipeline) ---
  const webhookSecret = 'whsec_perf28_local_test_secret_never_real';
  const provider = new StripeBillingProvider('sk_test_perf28_unused', webhookSecret);
  const custRes = await prisma.billingCustomer.create({ data: { workspaceId, provider: 'STRIPE', externalCustomerId: `cus_perf28_${runId}`, email: `perf28-${runId}@example.test` } });
  const webhookTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const rawBody = JSON.stringify({ id: `evt_perf28_${runId}_${String(i)}`, type: 'invoice.payment_succeeded', data: { object: { customer: custRes.externalCustomerId } } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: webhookSecret });
    webhookTimes.push(await time(() => processWebhook(rawBody, header, provider)));
  }
  report({ op: 'webhook processing (real Stripe SDK verify + idempotency)', ms: webhookTimes });

  // --- 6. Subscription mutation (real upgrade/downgrade state transitions) ---
  const mutationTimes: number[] = [];
  const plans = ['starter', 'pro', 'starter', 'pro'];
  for (let i = 0; i < N; i += 1) {
    const planKey = plans[i % plans.length] as string;
    mutationTimes.push(await time(() => changePlan(workspaceId, planKey, null)));
  }
  report({ op: 'subscription mutation (changePlan)', ms: mutationTimes });

  // --- 7. Entitlement lookup (real read path a request-hot-path check would take) ---
  const entitlementTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    entitlementTimes.push(
      await time(async () => {
        await getCurrentSubscription(workspaceId);
        await getAiCreditStatus(workspaceId);
      })
    );
  }
  report({ op: 'entitlement lookup (subscription + credit status)', ms: entitlementTimes });

  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error('perf-phase28 failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
