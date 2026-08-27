import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { processWebhook } from './webhook.service';
import { StripeBillingProvider } from './stripe-billing-provider';
import { getCurrentSubscription, transitionSubscription } from './subscription.service';
import { createScheduledWorkflow } from '../scheduler/scheduled-workflow.service';
import { tickScheduler, SCHEDULED_WORKFLOW_JOB_KEY } from '../scheduler/scheduler-tick.service';

/**
 * Phase 28 Task #45: the security/multi-tenancy regressions specific to
 * this phase's NEW surface that are not already covered elsewhere.
 *
 * Already covered by existing suites (not repeated here):
 * - Cross-tenant subscription/usage/invoice read access, cross-tenant plan
 *   mutation, no client-writable AICredit/Subscription.status endpoint —
 *   commercial-security.integration.test.ts.
 * - Cross-tenant ScheduledWorkflow read/list/enable-disable (path
 *   tampering, tenant-isolated listing) — scheduled-workflow.integration.test.ts.
 * - Invalid/forged/replayed/duplicate webhook signatures, unknown-customer
 *   fail-closed handling, forged `workspaceId` field in a real Stripe
 *   payload — stripe-webhook-idempotency.integration.test.ts.
 * - Unauthorized admin actions (403 for non-admin/workspace-owner, 401
 *   unauthenticated) on every admin route including credit adjustment —
 *   admin.integration.test.ts.
 *
 * Genuinely new here:
 * 1. Cross-tenant WEBHOOK EFFECT isolation between two real, KNOWN
 *    customers (not just "unknown customer id") — proves a validly signed
 *    event for workspace A's Stripe customer can never mutate workspace
 *    B's subscription/credit state, even when B's BillingCustomer row
 *    exists and is resolvable.
 * 2. A real, executed secret-leakage scan: captures actual console output
 *    from a real scheduler tick and a real webhook-processing cycle and
 *    asserts the real secret values never appear in it — stronger evidence
 *    than a static source grep, since it exercises the real code paths.
 */
describe('Phase 28 security & multi-tenancy regression (integration)', () => {
  const webhookSecret = 'whsec_test_secret_for_local_signature_testing_only_never_a_real_key';
  const secretKey = 'sk_test_secret_for_local_signature_testing_only_never_a_real_key';
  const provider = new StripeBillingProvider(secretKey, webhookSecret);
  const runId = randomUUID().slice(0, 8);

  function signedEvent(id: string, type: string, object: Record<string, unknown>): { rawBody: string; header: string } {
    const rawBody = JSON.stringify({ id, type, data: { object } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: webhookSecret });
    return { rawBody, header };
  }

  describe('cross-tenant webhook effect isolation', () => {
    let ownerA: Awaited<ReturnType<typeof registerTestUser>>;
    let workspaceA: Awaited<ReturnType<typeof createTestWorkspace>>;
    let customerA: string;
    let ownerB: Awaited<ReturnType<typeof registerTestUser>>;
    let workspaceB: Awaited<ReturnType<typeof createTestWorkspace>>;
    let customerB: string;

    beforeAll(async () => {
      await ensureSeeded();
      ownerA = await registerTestUser('Phase28 Tenant A Owner');
      workspaceA = await createTestWorkspace(ownerA.accessToken, 'Phase28 Tenant A Workspace');
      customerA = `cus_test_a_${runId}`;
      await prisma.billingCustomer.create({ data: { workspaceId: workspaceA.workspaceId, provider: 'STRIPE', externalCustomerId: customerA, email: ownerA.email } });

      ownerB = await registerTestUser('Phase28 Tenant B Owner');
      workspaceB = await createTestWorkspace(ownerB.accessToken, 'Phase28 Tenant B Workspace');
      customerB = `cus_test_b_${runId}`;
      await prisma.billingCustomer.create({ data: { workspaceId: workspaceB.workspaceId, provider: 'STRIPE', externalCustomerId: customerB, email: ownerB.email } });
    });

    afterAll(async () => {
      await cleanupTestUser(ownerA.email);
      await cleanupTestUser(ownerB.email);
    });

    it('a real, validly-signed event for tenant A\'s known Stripe customer only ever mutates A\'s subscription — B\'s state (a distinct, resolvable BillingCustomer) is untouched', async () => {
      await transitionSubscription(workspaceA.workspaceId, 'PAST_DUE', ownerA.userId);
      await transitionSubscription(workspaceB.workspaceId, 'PAST_DUE', ownerB.userId);
      const bBefore = await getCurrentSubscription(workspaceB.workspaceId);
      expect(bBefore.status).toBe('PAST_DUE');

      const { rawBody, header } = signedEvent(`evt_phase28_cross_tenant_${runId}`, 'invoice.payment_succeeded', { customer: customerA });
      const result = await processWebhook(rawBody, header, provider);
      expect(result.outcome).toBe('processed');

      const aAfter = await getCurrentSubscription(workspaceA.workspaceId);
      expect(aAfter.status).toBe('ACTIVE'); // A's event, A's effect

      const bAfter = await getCurrentSubscription(workspaceB.workspaceId);
      expect(bAfter.status).toBe('PAST_DUE'); // B is a real, distinct, resolvable tenant — must be completely unaffected
    });

    it('a real event for tenant B\'s customer never grants or removes tenant A\'s credits', async () => {
      const aCreditsBefore = await prisma.aICredit.aggregate({ where: { workspaceId: workspaceA.workspaceId }, _sum: { amount: true } });

      const { rawBody, header } = signedEvent(`evt_phase28_cross_tenant_credits_${runId}`, 'invoice.payment_failed', { customer: customerB });
      const result = await processWebhook(rawBody, header, provider);
      expect(result.outcome).toBe('processed');

      const aCreditsAfter = await prisma.aICredit.aggregate({ where: { workspaceId: workspaceA.workspaceId }, _sum: { amount: true } });
      expect(aCreditsAfter._sum.amount).toBe(aCreditsBefore._sum.amount);
    });
  });

  describe('secret leakage scan (real execution, real console capture)', () => {
    let owner: Awaited<ReturnType<typeof registerTestUser>>;
    let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;
    let captured: string[];
    let createdScheduleId: string | undefined;

    beforeAll(async () => {
      await ensureSeeded();
      owner = await registerTestUser('Phase28 Secret Scan Owner');
      workspace = await createTestWorkspace(owner.accessToken, 'Phase28 Secret Scan Workspace');
      await prisma.billingCustomer.create({ data: { workspaceId: workspace.workspaceId, provider: 'STRIPE', externalCustomerId: `cus_test_scan_${runId}`, email: owner.email } });
    });

    afterAll(async () => {
      // Job has no FK to any tenant table (Phase 27 design — platform-level
      // infrastructure), so it survives cleanupTestUser's cascading delete.
      // Left uncleaned, it becomes exactly the orphaned-shared-jobKey
      // contamination scheduler-tick.integration.test.ts's beforeEach hook
      // was added to guard against — swept here for the same reason.
      if (createdScheduleId) {
        await prisma.job.deleteMany({ where: { jobKey: SCHEDULED_WORKFLOW_JOB_KEY, dedupeKey: { startsWith: createdScheduleId } } });
      }
      await cleanupTestUser(owner.email);
    });

    beforeEach(() => {
      captured = [];
      logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      });
      errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(' '));
      });
    });

    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('a real scheduler tick (create + claim + enqueue) never logs the Stripe secret key or webhook secret', async () => {
      const schedule = await createScheduledWorkflow({
        workspaceId: workspace.workspaceId,
        createdByUserId: owner.userId,
        workflowDefinitionKey: 'marketing-autopilot',
        name: `Secret scan schedule ${runId}`,
        intervalUnit: 'MINUTE',
        intervalValue: 5,
        timezone: 'UTC',
      });
      createdScheduleId = schedule.id;
      await tickScheduler(new Date(Date.now() + 6 * 60_000));

      const combined = captured.join('\n');
      expect(combined).not.toContain(secretKey);
      expect(combined).not.toContain(webhookSecret);
      expect(combined.toLowerCase()).not.toContain('sk_test_secret_for_local');
    });

    it('a real webhook signature verification + processing cycle never logs the webhook secret or a raw signature header', async () => {
      const { rawBody, header } = signedEvent(`evt_phase28_secret_scan_${runId}`, 'invoice.payment_succeeded', { customer: `cus_test_scan_${runId}` });
      await processWebhook(rawBody, header, provider);

      const combined = captured.join('\n');
      expect(combined).not.toContain(webhookSecret);
      expect(combined).not.toContain(header);
      expect(combined).not.toContain(secretKey);
    });
  });
});
