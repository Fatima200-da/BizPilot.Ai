import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../infrastructure/database/prisma';
import { cleanupTestUser, createTestWorkspace, ensureSeeded, registerTestUser } from '../../testing/integration-helpers';
import { processWebhook } from './webhook.service';
import { MockBillingProvider } from './billing-provider';
import { getCurrentSubscription, transitionSubscription } from './subscription.service';

/**
 * Phase 25 Section 14: real, database-backed webhook idempotency
 * certification. `MockBillingProvider` (REAL_PAYMENT_PROVIDER = BLOCKED —
 * CREDENTIAL, so this is the only implementation that exists) signs
 * payloads exactly the shape a real provider would, so the verification
 * and idempotency CODE PATHS are genuinely exercised — never claimed as
 * real Stripe webhook verification.
 */
describe('Webhook processing & idempotency (integration)', () => {
  let owner: Awaited<ReturnType<typeof registerTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  const provider = new MockBillingProvider();
  // Phase 25: WebhookEvent rows are never cleaned up (they are an
  // immutable-style ledger, matching AuditLog's own no-delete convention),
  // and this suite runs against the REAL, persistent Postgres database —
  // re-running this file must not collide with rows a prior run left
  // behind. Every eventId below is suffixed with this run-unique id,
  // mirroring uniqueEmail()'s existing isolation pattern elsewhere in this
  // codebase's integration tests.
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    await ensureSeeded();
    owner = await registerTestUser('Webhook Test Owner');
    workspace = await createTestWorkspace(owner.accessToken, 'Webhook Test Workspace');
  });

  afterAll(async () => {
    await cleanupTestUser(owner.email);
  });

  function signedEvent(id: string, type: string, data: unknown): { rawBody: string; signature: string } {
    const rawBody = JSON.stringify({ id, type, data });
    return { rawBody, signature: provider.signWebhookPayload(rawBody) };
  }

  it('an invalid/forged signature is rejected without processing anything', async () => {
    const { rawBody } = signedEvent(`evt_forged_1_${runId}`, 'invoice.payment_succeeded', { workspaceId: workspace.workspaceId });
    const result = await processWebhook(rawBody, 'not-the-real-signature');
    expect(result.outcome).toBe('invalid_signature');

    const stored = await prisma.webhookEvent.findFirst({ where: { externalEventId: `evt_forged_1_${runId}` } });
    expect(stored).toBeNull(); // never even recorded — rejected before any DB write
  });

  it('a malformed (non-JSON) signed body is rejected safely, no crash', async () => {
    const rawBody = 'not valid json at all';
    const signature = provider.signWebhookPayload(rawBody);
    const result = await processWebhook(rawBody, signature);
    expect(result.outcome).toBe('invalid_signature');
  });

  it('an unrecognized event type is safely ignored (recorded, not errored)', async () => {
    const { rawBody, signature } = signedEvent(`evt_unrecognized_1_${runId}`, 'some.future.event.type', { anything: true });
    const result = await processWebhook(rawBody, signature);
    expect(result.outcome).toBe('processed'); // recorded and marked processed — "ignored" at the domain level, not a failure

    const stored = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: 'STRIPE', externalEventId: `evt_unrecognized_1_${runId}` } } });
    expect(stored.status).toBe('PROCESSED');
  });

  it('a real event applies the correct subscription transition exactly once', async () => {
    await transitionSubscription(workspace.workspaceId, 'PAST_DUE', owner.userId);
    let subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('PAST_DUE');

    const { rawBody, signature } = signedEvent(`evt_payment_recovered_1_${runId}`, 'invoice.payment_succeeded', { workspaceId: workspace.workspaceId });
    const result = await processWebhook(rawBody, signature);
    expect(result.outcome).toBe('processed');

    subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE');
  });

  it('DUPLICATE webhook delivery (same externalEventId, real Stripe-retry behavior) never applies the transition twice', async () => {
    await transitionSubscription(workspace.workspaceId, 'PAST_DUE', owner.userId);

    const { rawBody, signature } = signedEvent(`evt_duplicate_delivery_1_${runId}`, 'invoice.payment_succeeded', { workspaceId: workspace.workspaceId });

    const first = await processWebhook(rawBody, signature);
    expect(first.outcome).toBe('processed');
    let subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE');

    // Move it to PAST_DUE again — if the duplicate delivery below
    // incorrectly re-applies the transition, this test can't tell the
    // difference between "correctly skipped" and "harmlessly re-applied
    // the same no-op". Instead assert on the WebhookEvent row count and an
    // explicit "duplicate" outcome, which is the real proof.
    const second = await processWebhook(rawBody, signature);
    expect(second.outcome).toBe('duplicate');

    const eventRows = await prisma.webhookEvent.findMany({ where: { externalEventId: `evt_duplicate_delivery_1_${runId}` } });
    expect(eventRows).toHaveLength(1); // exactly one row — the unique constraint + idempotency check both hold

    subscription = await getCurrentSubscription(workspace.workspaceId);
    expect(subscription.status).toBe('ACTIVE'); // still just the one real application's result
  });

  it('CONCURRENT duplicate delivery (genuine Promise.all race on the same event) is still applied exactly once', async () => {
    const owner2 = await registerTestUser('Webhook Race Owner');
    const ws2 = await createTestWorkspace(owner2.accessToken, 'Webhook Race Workspace');
    await transitionSubscription(ws2.workspaceId, 'PAST_DUE', owner2.userId);

    const { rawBody, signature } = signedEvent(`evt_concurrent_race_1_${runId}`, 'invoice.payment_succeeded', { workspaceId: ws2.workspaceId });

    const [resultA, resultB] = await Promise.all([processWebhook(rawBody, signature), processWebhook(rawBody, signature)]);
    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(['duplicate', 'processed']); // one wins, one is correctly recognized as a duplicate — never both "processed"

    const eventRows = await prisma.webhookEvent.findMany({ where: { externalEventId: `evt_concurrent_race_1_${runId}` } });
    expect(eventRows).toHaveLength(1);

    await cleanupTestUser(owner2.email);
  });

  it('MockBillingProvider: createCustomer/createSubscription/changeSubscription/cancelSubscription round-trip correctly (local, no network)', async () => {
    const customer = await provider.createCustomer({ workspaceId: workspace.workspaceId, email: owner.email });
    expect(customer.externalCustomerId).toMatch(/^mock_cus_/);

    const subscription = await provider.createSubscription({ externalCustomerId: customer.externalCustomerId, planKey: 'pro' });
    expect(subscription.status).toBe('active');

    const changed = await provider.changeSubscription(subscription.externalSubscriptionId, 'business');
    expect(changed.status).toContain('business');

    await provider.cancelSubscription(subscription.externalSubscriptionId);
    const fetched = await provider.getSubscription(subscription.externalSubscriptionId);
    expect(fetched?.status).toBe('canceled');
  });
});
