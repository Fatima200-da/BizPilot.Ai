import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { assertSufficientCredits, grantCredits, recordUsage } from './credit-ledger.service';
import { startMarketingAutopilotSchema } from '../marketing-autopilot/marketing-autopilot.schemas';

/**
 * Phase 24 Section 17: reproducible local performance measurement of the AI
 * subsystem's OWN overhead — validation, credit check, billing write,
 * step-engine DB round trips — deliberately isolated from any external
 * provider latency (REAL_AI_PROVIDER is BLOCKED — CREDENTIAL; no real
 * provider latency exists to measure, and none is invented here). The
 * MockProviderAdapter's synthetic 40-180ms sleep is reported SEPARATELY
 * and explicitly labeled as simulated, not orchestration overhead.
 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

function summarize(label: string, samples: number[]): { label: string; p50: number; p95: number; min: number; max: number } {
  const sorted = [...samples].sort((a, b) => a - b);
  const result = { label, p50: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0 };

  console.log(`[perf] ${label}: p50=${result.p50.toFixed(2)}ms p95=${result.p95.toFixed(2)}ms min=${result.min.toFixed(2)}ms max=${result.max.toFixed(2)}ms n=${String(samples.length)}`);
  return result;
}

describe('AI pipeline local performance (integration, real Postgres)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let businessProfileId: string;
  const N = 30;

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Perf Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Perf Test Workspace');
    await grantCredits({ workspaceId: workspace.workspaceId, amount: 10_000, type: 'MANUAL_ADJUSTMENT', note: 'Phase 24 perf test headroom' });
    const profileRes = await request(app)
      .post(`/api/v1/workspaces/${workspace.workspaceId}/business-profiles`)
      .set('Authorization', `Bearer ${workspace.accessToken}`)
      .send({ name: 'Perf Test Biz', industry: 'Test', targetAudience: 'Test', contentLanguage: 'AZ' });
    businessProfileId = (profileRes.body as { data: { id: string } }).data.id;
  }, 30_000);

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  it('input validation (in-process, no I/O) — p95 must be sub-millisecond scale', () => {
    const samples: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const start = performance.now();
      startMarketingAutopilotSchema.safeParse({ businessProfileId, objective: 'bookings', platforms: ['instagram'] });
      samples.push(performance.now() - start);
    }
    const { p95 } = summarize('input validation (Zod, no I/O)', samples);
    expect(p95).toBeLessThan(10); // generous — pure in-memory schema parsing
  });

  it('credit pre-flight check (assertSufficientCredits, real DB read) latency', async () => {
    const samples: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const start = performance.now();

      await assertSufficientCredits(workspace.workspaceId, 1);
      samples.push(performance.now() - start);
    }
    const { p95 } = summarize('credit pre-flight check (real DB read)', samples);
    expect(p95).toBeLessThan(500); // generous local-DB bound, not a provider-latency claim
  });

  it('billing write (recordUsage, real DB transaction with row lock) latency', async () => {
    const samples: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const start = performance.now();

      await recordUsage({ workspaceId: workspace.workspaceId, actionType: 'AUTOMATION_RUN', creditsConsumed: 1 });
      samples.push(performance.now() - start);
    }
    const { p95 } = summarize('billing write (real DB transaction, FOR UPDATE lock)', samples);
    expect(p95).toBeLessThan(500);
  });

  it('full HTTP AI-trigger pipeline (validation + auth + credit-check + mock provider x3 + validation + billing x3 + persistence) — reported with the mock provider\'s simulated delay explicitly separated', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();

      const res = await request(app)
        .post(`/api/v1/workspaces/${workspace.workspaceId}/workflows/marketing-autopilot`)
        .set('Authorization', `Bearer ${workspace.accessToken}`)
        .send({ businessProfileId, idempotencyKey: `perf-${String(i)}-${String(Date.now())}` });
      samples.push(performance.now() - start);
      expect(res.status).toBe(201);
    }
    const { p50, p95 } = summarize('full HTTP AI-trigger (includes MockProviderAdapter\'s synthetic 40-180ms x3 sleep, NOT real provider latency)', samples);

    console.log('[perf] NOTE: MockProviderAdapter simulates 40-180ms per call (3 calls/run) by design (see mock-provider.adapter.ts) — this is a local synthetic delay, not measured or invented external OpenAI latency, which remains BLOCKED — CREDENTIAL.');
    expect(p95).toBeLessThan(5000); // sanity bound only — not a provider SLA claim
    expect(p50).toBeGreaterThan(0);
  });
});
