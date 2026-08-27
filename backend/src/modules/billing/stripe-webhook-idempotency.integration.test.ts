import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { processWebhook } from './webhook.service';
import { StripeBillingProvider } from './stripe-billing-provider';
import { getCurrentSubscription, transitionSubscription } from './subscription.service';

/**
 * Phase 28 Track B Section 5: the real database-backed webhook idempotency
 * pipeline (Phase 25, unchanged) driven end-to-end by a REAL
 * `StripeBillingProvider` instance and REAL Stripe-signed payloads
 * (`Stripe.webhooks.generateTestHeaderString` — genuine local
 * cryptography, no network call). This is strictly stronger evidence than
 * webhook.integration.test.ts's `MockBillingProvider` coverage: the
 * signature verification step here is the actual Stripe SDK's real
 * `constructEvent`, not a same-codebase HMAC mirror of it.
 *
 * Real defect found and fixed while building this file: `applyEvent`
 * (webhook.service.ts) originally read `workspaceId` directly off the
 * verified payload — correct for MockBillingProvider's synthetic test
 * shape, but a genuine Stripe Invoice/Subscription object has no such
 * field (that's OUR internal id, never Stripe's concept). Fixed by
 * resolving the real workspace via `data.customer` (Stripe's real
 * customer-id field, present on every real Invoice/Subscription payload)
 * through a real `BillingCustomer` lookup — the same mapping a real
 * checkout/subscribe flow creates. Every event body below uses the REAL
 * Stripe envelope shape (`{ id, type, data: { object: {...} } }`), not a
 * simplified test shape.
 */
describe('Stripe webhook idempotency & replay (integration, real Stripe SDK signature verification)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let stripeCustomerId: string;
  const webhookSecret = 'whsec_test_secret_for_local_signature_testing_only_never_a_real_key';
  const provider = new StripeBillingProvider('sk_test_unused_in_these_tests', webhookSecret);
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Stripe Webhook Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Stripe Webhook Test Workspace');

    // The real mapping a checkout/subscribe flow creates (Section 4) —
    // established directly here since no HTTP checkout endpoint exists yet
    // in this environment (BLOCKED — CREDENTIAL for the live Stripe API
    // call `createCustomer` would need to make).
    stripeCustomerId = `cus_test_${runId}`;
    await prisma.billingCustomer.create({
      data: { workspaceId: workspace.workspaceId, provider: 'STRIPE', externalCustomerId: stripeCustomerId, email: owner.email },
    });
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  /** The REAL Stripe webhook envelope shape: `data.object` is the actual resource, carrying `customer` — never our internal workspaceId. */
  function signedEvent(id: string, type: string, object: Record<string, unknown>): { rawBody: string; header: string } {
    const rawBody = JSON.stringify({ id, type, data: { object } });
    const header = Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret: webhookSecret });
    return { rawBody, header };
  }

  it('a real, validly Stripe-signed event resolves the workspace via the real BillingCustomer mapping and applies the correct subscription transition exactly once', async () => {
    await transitionSubscription(workspace.workspaceId, 'PAST_DUE', owner.userId);
    let subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('PAST_DUE');

    const { rawBody, header } = signedEvent(`evt_stripe_real_sig_${runId}`, 'invoice.payment_succeeded', { customer: stripeCustomerId });
    const result = await processWebhook(rawBody, header, provider);
    expect(result.outcome).toBe('processed');

    subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE');
  });

  it('an event for an unknown Stripe customer id (no matching BillingCustomer) fails safely and is recorded as FAILED, never silently applied to the wrong workspace', async () => {
    const { rawBody, header } = signedEvent(`evt_stripe_unknown_customer_${runId}`, 'invoice.payment_succeeded', { customer: 'cus_does_not_exist_anywhere' });
    // A real, correctly-signed Stripe event — but with no matching
    // BillingCustomer, this must fail closed: a real 'failed' outcome
    // (Phase 28's own fix — this used to be silently mislabeled
    // 'processed'), never a fallback to "the first workspace" or anything guessable.
    const result = await processWebhook(rawBody, header, provider);
    expect(result.outcome).toBe('failed');

    const stored = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: 'STRIPE', externalEventId: `evt_stripe_unknown_customer_${runId}` } } });
    expect(stored.status).toBe('FAILED');
    expect(stored.errorMessage).toContain('validation'); // ValidationError's real top-level message; the specific "could not be resolved" detail lives in its structured field-errors array, not err.message
  });

  it('an invalid Stripe signature (real cryptographic rejection, not a stub) is rejected before any DB write', async () => {
    const { rawBody } = signedEvent(`evt_stripe_forged_${runId}`, 'invoice.payment_succeeded', { customer: stripeCustomerId });
    const result = await processWebhook(rawBody, 'not-a-real-stripe-signature', provider);
    expect(result.outcome).toBe('invalid_signature');

    const stored = await prisma.webhookEvent.findFirst({ where: { externalEventId: `evt_stripe_forged_${runId}` } });
    expect(stored).toBeNull();
  });

  it('DUPLICATE Stripe webhook delivery (real Stripe retry behavior on anything but a 2xx) never applies the transition twice', async () => {
    await transitionSubscription(workspace.workspaceId, 'PAST_DUE', owner.userId);

    const { rawBody, header } = signedEvent(`evt_stripe_duplicate_${runId}`, 'invoice.payment_succeeded', { customer: stripeCustomerId });

    const first = await processWebhook(rawBody, header, provider);
    expect(first.outcome).toBe('processed');

    const second = await processWebhook(rawBody, header, provider);
    expect(second.outcome).toBe('duplicate');

    const eventRows = await prisma.webhookEvent.findMany({ where: { externalEventId: `evt_stripe_duplicate_${runId}` } });
    expect(eventRows).toHaveLength(1); // exactly one row — real unique constraint + idempotency check both hold for a real Stripe-signed event

    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE'); // still just the one real application's result
  });

  it('a REPLAYED event (an attacker re-sending a captured, genuinely-valid old signed payload) is rejected by Stripe\'s own timestamp tolerance, never reaching the idempotency layer at all', async () => {
    const payload = JSON.stringify({ id: `evt_stripe_replay_${runId}`, type: 'invoice.payment_succeeded', data: { object: { customer: stripeCustomerId } } });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes old — outside the real 300s tolerance
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: staleTimestamp });

    const result = await processWebhook(payload, header, provider);
    expect(result.outcome).toBe('invalid_signature'); // Stripe's real anti-replay check rejects it before our idempotency logic ever runs

    const stored = await prisma.webhookEvent.findFirst({ where: { externalEventId: `evt_stripe_replay_${runId}` } });
    expect(stored).toBeNull();
  });

  it('CONCURRENT duplicate delivery of a real Stripe-signed event (genuine Promise.all race) is still applied exactly once', async () => {
    const owner2 = await registerTestUser('Stripe Webhook Race Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Stripe Webhook Race Workspace');
    const customer2 = `cus_test_race_${runId}`;
    await prisma.billingCustomer.create({ data: { workspaceId: ws2.workspaceId, provider: 'STRIPE', externalCustomerId: customer2, email: owner2.email } });
    await transitionSubscription(ws2.workspaceId, 'PAST_DUE', owner2.userId);

    const { rawBody, header } = signedEvent(`evt_stripe_concurrent_${runId}`, 'invoice.payment_succeeded', { customer: customer2 });

    const [resultA, resultB] = await Promise.all([processWebhook(rawBody, header, provider), processWebhook(rawBody, header, provider)]);
    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(['duplicate', 'processed']);

    const eventRows = await prisma.webhookEvent.findMany({ where: { externalEventId: `evt_stripe_concurrent_${runId}` } });
    expect(eventRows).toHaveLength(1);

    await cleanupTestUser(owner2.email);
  });

  it('a Stripe event for a payment FAILURE correctly transitions the subscription to PAST_DUE, never granting unauthorized entitlements', async () => {
    await transitionSubscription(workspace.workspaceId, 'ACTIVE', owner.userId);
    const balanceBefore = await prisma.aICredit.aggregate({ where: { workspaceId: workspace.workspaceId }, _sum: { amount: true } });

    const { rawBody, header } = signedEvent(`evt_stripe_payment_failed_${runId}`, 'invoice.payment_failed', { customer: stripeCustomerId });
    const result = await processWebhook(rawBody, header, provider);
    expect(result.outcome).toBe('processed');

    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('PAST_DUE');

    // A failed payment never grants new credits — entitlements stay server-authoritative.
    const balanceAfter = await prisma.aICredit.aggregate({ where: { workspaceId: workspace.workspaceId }, _sum: { amount: true } });
    expect(balanceAfter._sum.amount).toBe(balanceBefore._sum.amount);

    // Phase 29 real gap closed: the customer is actually told why —
    // PAYMENT_FAILED existed as a real NotificationType with zero call
    // sites before this phase.
    const notification = await prisma.notification.findFirst({ where: { workspaceId: workspace.workspaceId, type: 'PAYMENT_FAILED' } });
    expect(notification).not.toBeNull();
  });

  it('a forged webhook payload (real signature, but crafted with someone ELSE\'s real Stripe customer id) cannot be used to manipulate a workspace the caller does not own — the resolution is purely server-side via BillingCustomer, never trusts anything the payload claims beyond the customer id itself', async () => {
    // "Forgery" here is bounded by what's actually attacker-controlled: a
    // real Stripe signature can only be produced by someone holding the
    // real webhook secret (Stripe itself), so the real attack surface is a
    // COMPROMISED but validly-signed event referencing an unexpected
    // customer id — proven above to resolve deterministically via
    // BillingCustomer, never via any client/attacker-suppliable workspaceId
    // field (which this Stripe payload shape doesn't even have).
    const { rawBody, header } = signedEvent(`evt_stripe_forged_workspace_claim_${runId}`, 'invoice.payment_succeeded', {
      customer: stripeCustomerId,
      workspaceId: '00000000-0000-4000-8000-000000000099', // an attempted forged field — must be completely ignored for a Stripe-shaped event
    });
    const result = await processWebhook(rawBody, header, provider);
    expect(result.outcome).toBe('processed');

    // Resolved via the REAL customer->workspace mapping, not the forged field.
    const subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE');
  });
});
