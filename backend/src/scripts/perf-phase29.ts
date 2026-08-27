/**
 * Phase 29 Section 29: real p50/p95/p99 latency measurement for this
 * phase's new operations, run in-process against real Postgres — same
 * honest methodology as perf-phase28.ts (a practical smoke measurement,
 * not a formal benchmark suite; n=20 makes p99 statistically thin and it
 * is reported as such, never presented as an SLA).
 *
 * AI_PROVIDER is `mock` in this environment (no real OpenAI credential) —
 * any timing here that passes through the workflow engine's AI step is
 * MOCK PROVIDER LATENCY, not representative of a real OpenAI call, and is
 * labeled as such below rather than silently presented as a real number.
 *
 * Run: npx tsx src/scripts/perf-phase29.ts
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../infrastructure/database/prisma';
import { seedRbac } from './seed-rbac';
import { seedWorkflowDefinitions } from './seed-workflow-definitions';
import { seedSubscriptionPlans } from './seed-subscription-plans';
import { trackEvent, listRecentWorkspaceActivity } from '../modules/analytics/product-event.service';
import { getActivationMetrics } from '../modules/analytics/activation-metrics.service';
import { listDeadLetterJobs } from '../modules/admin/admin.service';
import { submitFeedback, listWorkspaceFeedback } from '../modules/feedback/feedback.service';

interface Timing {
  op: string;
  ms: number[];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function report(t: Timing, note?: string): void {
  const sorted = [...t.ms].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const suffix = note ? `  [${note}]` : '';
  console.log(`${t.op.padEnd(38)} n=${String(t.ms.length).padStart(3)}  p50=${p50.toFixed(1).padStart(7)}ms  p95=${p95.toFixed(1).padStart(7)}ms  p99=${p99.toFixed(1).padStart(7)}ms${suffix}`);
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

  const reg = await request(app).post('/api/v1/auth/register').send({ email: `perf29-${runId}@example.test`, password: 'password1234', fullName: 'Perf29' });
  const regBody = reg.body as { data: { accessToken: string; user: { id: string } } };
  const wsRes = await request(app).post('/api/v1/workspaces').set('Authorization', `Bearer ${regBody.data.accessToken}`).send({ name: 'Perf29 WS' });
  const wsBody = wsRes.body as { data: { accessToken: string; workspace: { id: string } } };
  const workspaceId = wsBody.data.workspace.id;
  const wsToken = wsBody.data.accessToken;
  const userId = regBody.data.user.id;

  // --- 1. trackEvent (fire-and-forget hot path, called on nearly every business action) ---
  const trackTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    trackTimes.push(await time(() => trackEvent({ workspaceId, userId, eventName: 'dashboard_viewed' })));
  }
  report({ op: 'trackEvent (product event write)', ms: trackTimes });

  // --- 2. GET /events/activity — new dashboard-load query ---
  const activityTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    activityTimes.push(await time(() => listRecentWorkspaceActivity(workspaceId)));
  }
  report({ op: 'listRecentWorkspaceActivity (dashboard read)', ms: activityTimes });

  // --- 3. getActivationMetrics — admin-facing aggregate, real cross-tenant scan ---
  const activationTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    activationTimes.push(await time(() => getActivationMetrics()));
  }
  report({ op: 'getActivationMetrics (admin aggregate)', ms: activationTimes });

  // --- 4. listDeadLetterJobs — admin ops read ---
  const jobsTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    jobsTimes.push(await time(() => listDeadLetterJobs()));
  }
  report({ op: 'listDeadLetterJobs (admin ops read)', ms: jobsTimes });

  // --- 5. feedback submit + list round-trip ---
  const feedbackTimes: number[] = [];
  for (let i = 0; i < N; i += 1) {
    feedbackTimes.push(
      await time(async () => {
        await submitFeedback({ workspaceId, userId, type: 'GENERAL', message: `perf29 feedback ${String(i)}` });
        await listWorkspaceFeedback(workspaceId);
      })
    );
  }
  report({ op: 'feedback submit + list (round-trip)', ms: feedbackTimes });

  // --- 6. Real workflow start -> retry chain (Section 10), through the actual HTTP surface ---
  const bpRes = await request(app)
    .post(`/api/v1/workspaces/${workspaceId}/business-profiles`)
    .set('Authorization', `Bearer ${wsToken}`)
    .send({ name: 'Perf29 Biz', industry: 'retail', targetAudience: 'general', contentLanguage: 'AZ' });
  const bpBody = bpRes.body as { data: { id: string } };
  const workflowTimes: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    workflowTimes.push(
      await time(async () => {
        await request(app)
          .post(`/api/v1/workspaces/${workspaceId}/workflows/marketing-autopilot`)
          .set('Authorization', `Bearer ${wsToken}`)
          .send({ businessProfileId: bpBody.data.id, objective: 'sales', platforms: ['instagram'] });
      })
    );
  }
  report({ op: 'marketing-autopilot workflow start (HTTP, full run)', ms: workflowTimes }, 'includes MOCK PROVIDER LATENCY — AI_PROVIDER=mock, not representative of a real OpenAI call');

  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error('perf-phase29 failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
