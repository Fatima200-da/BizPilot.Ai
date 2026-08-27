import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { recordUsage } from '../billing/credit-ledger.service';
import { getActivationMetrics } from './activation-metrics.service';

/**
 * Phase 30 Track H.15: analytics event integrity. Audits `ProductEvent`
 * against the phase's own checklist (duplicate/missing/wrong-workspace/
 * forged-user/replayed/concurrent events). Most of this was already real,
 * tested behavior from Phase 29 (cross-tenant write blocked, client
 * allowlist enforced — see product-event.integration.test.ts). This file
 * covers what wasn't: forged-userId protection at the client endpoint, and
 * — the real find — a genuine concurrency race in the gated "first-X"
 * event pattern.
 */
describe('Phase 30: analytics event integrity (integration)', () => {
  beforeAll(async () => {
    await ensureSeeded();
  });

  it('a client cannot forge a userId in the event-tracking request body — the recorded event always uses the real, verified-JWT actor, never a client-supplied value', async () => {
    const user = await registerTestUser('Event Integrity Forge User');
    const ws = await createTestWorkspace(user.accessToken, 'Event Integrity Forge Workspace');
    const someoneElse = await registerTestUser('Event Integrity Forge Victim');

    const res = await request(app)
      .post(`/api/v1/workspaces/${ws.workspaceId}/events`)
      .set('Authorization', `Bearer ${ws.accessToken}`)
      .send({ eventName: 'dashboard_viewed', properties: { userId: someoneElse.userId } }); // an attempted forge — not a real field the controller reads for identity

    expect(res.status).toBe(200);
    const stored = await prisma.productEvent.findFirst({ where: { workspaceId: ws.workspaceId, eventName: 'dashboard_viewed' }, orderBy: { createdAt: 'desc' } });
    expect(stored?.userId).toBe(user.userId); // the REAL authenticated actor, never the forged value

    await cleanupTestUser(user.email);
    await cleanupTestUser(someoneElse.email);
  });

  it('CONCURRENT first-AI-action calls for the same brand-new workspace record the gated event EXACTLY ONCE — real concurrency, not two sequential calls', async () => {
    const owner = await registerTestUser('Event Integrity Concurrency Owner');
    const ws = await createTestWorkspace(owner.accessToken, 'Event Integrity Concurrency Workspace');

    // Real concurrent execution — TEMP: 20-way to stress-test the race window
    await Promise.all(
      Array.from({ length: 20 }, () => recordUsage({ workspaceId: ws.workspaceId, userId: owner.userId, actionType: 'CONTENT_SHORT', creditsConsumed: 1 }))
    );

    const firstActionEvents = await prisma.productEvent.count({ where: { workspaceId: ws.workspaceId, eventName: 'first_ai_action' } });
    expect(firstActionEvents).toBe(1); // real proof of exactly-once — a duplicate here would double-count in every activation metric that treats this as a real "first" moment

    await cleanupTestUser(owner.email);
  });

  it('activation metrics never claim a rate from an insufficient sample — real, structural proof the classification holds under real data, not just the unit-tested boundary logic', async () => {
    const snapshot = await getActivationMetrics();
    for (const metric of Object.values(snapshot)) {
      if (typeof metric !== 'object' || metric === null || !('status' in metric)) continue;
      const m = metric as { status: string; denominator?: number; sampleSize?: number };
      if (m.status !== 'OBSERVED') continue;
      const sample = typeof m.denominator === 'number' ? m.denominator : m.sampleSize;
      expect(sample).toBeGreaterThanOrEqual(10); // MIN_SAMPLE_SIZE — an OBSERVED rate/duration below this threshold would be exactly the misleading-percentage failure mode this system exists to prevent
    }
  });
});
