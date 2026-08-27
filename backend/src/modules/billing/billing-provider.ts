import { randomUUID, createHmac } from 'node:crypto';
import { env } from '../../config/env';
import { getStripeBillingProvider } from './stripe-billing-provider';

/**
 * Phase 25 Section 13: a payment-provider-neutral interface. No domain
 * service (subscription.service.ts, invoice.service.ts) may import a
 * concrete provider — only this interface, exactly mirroring Phase 24's
 * `AIProviderPort` hexagonal pattern (infrastructure/ai/ai-provider.port.ts)
 * for the AI provider abstraction.
 *
 * Phase 28 Track B: `StripeBillingProvider` now exists
 * (stripe-billing-provider.ts) behind this exact same interface — swapping
 * it in via `PAYMENT_PROVIDER=stripe` required zero changes to any caller,
 * exactly as Phase 24 proved for the AI provider swap. `REAL_PAYMENT_PROVIDER`
 * remains `BLOCKED — CREDENTIAL` in THIS environment specifically (no real
 * Stripe key exists here) — not because the adapter doesn't exist.
 */
export interface BillingCustomerRecord {
  externalCustomerId: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  sessionId: string;
}

export interface ExternalSubscription {
  externalSubscriptionId: string;
  status: string;
}

export interface PortalSession {
  portalUrl: string;
}

export interface VerifiedWebhookEvent {
  eventId: string;
  eventType: string;
  payload: unknown;
}

export interface BillingProvider {
  readonly name: string;
  createCustomer(params: { workspaceId: string; email: string }): Promise<BillingCustomerRecord>;
  createCheckoutSession(params: { externalCustomerId: string; planKey: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession>;
  createSubscription(params: { externalCustomerId: string; planKey: string }): Promise<ExternalSubscription>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  changeSubscription(externalSubscriptionId: string, newPlanKey: string): Promise<ExternalSubscription>;
  getSubscription(externalSubscriptionId: string): Promise<ExternalSubscription | null>;
  createPortalSession(externalCustomerId: string): Promise<PortalSession>;
  /** Returns null on an invalid/forged signature — never throws, so callers can respond safely (e.g. 400) without a crash. */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): VerifiedWebhookEvent | null;
}

/**
 * Deterministic, fully local implementation — no network calls, no real
 * money movement, ever. `signWebhookPayload` is exposed only so this
 * phase's own tests can construct a validly-signed webhook body to drive
 * `webhook.service.ts` realistically (mirroring how a real provider would
 * sign a payload) without needing a real provider account.
 */
export class MockBillingProvider implements BillingProvider {
  readonly name = 'mock';
  private readonly webhookSecret = 'mock-webhook-secret-local-only';
  private readonly subscriptions = new Map<string, ExternalSubscription>();

  createCustomer(params: { workspaceId: string; email: string }): Promise<BillingCustomerRecord> {
    return Promise.resolve({ externalCustomerId: `mock_cus_${params.workspaceId.slice(0, 8)}_${randomUUID().slice(0, 8)}` });
  }

  createCheckoutSession(params: { externalCustomerId: string; planKey: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession> {
    const sessionId = `mock_cs_${randomUUID()}`;
    return Promise.resolve({ checkoutUrl: `${params.successUrl}?mock_session=${sessionId}&plan=${params.planKey}`, sessionId });
  }

  createSubscription(_params: { externalCustomerId: string; planKey: string }): Promise<ExternalSubscription> {
    const externalSubscriptionId = `mock_sub_${randomUUID()}`;
    const record: ExternalSubscription = { externalSubscriptionId, status: 'active' };
    this.subscriptions.set(externalSubscriptionId, record);
    return Promise.resolve(record);
  }

  cancelSubscription(externalSubscriptionId: string): Promise<void> {
    const existing = this.subscriptions.get(externalSubscriptionId);
    if (existing) this.subscriptions.set(externalSubscriptionId, { ...existing, status: 'canceled' });
    return Promise.resolve();
  }

  changeSubscription(externalSubscriptionId: string, newPlanKey: string): Promise<ExternalSubscription> {
    const existing = this.subscriptions.get(externalSubscriptionId) ?? { externalSubscriptionId, status: 'active' };
    const updated: ExternalSubscription = { ...existing, status: 'active' };
    this.subscriptions.set(externalSubscriptionId, updated);
    return Promise.resolve({ ...updated, status: `active_on_${newPlanKey}` });
  }

  getSubscription(externalSubscriptionId: string): Promise<ExternalSubscription | null> {
    return Promise.resolve(this.subscriptions.get(externalSubscriptionId) ?? null);
  }

  createPortalSession(externalCustomerId: string): Promise<PortalSession> {
    return Promise.resolve({ portalUrl: `https://billing.mock.local/portal/${externalCustomerId}` });
  }

  /** Real providers (Stripe) sign `${timestamp}.${rawBody}` with HMAC-SHA256; this mirrors that shape so the verification CODE PATH is genuinely exercised, not stubbed out. */
  signWebhookPayload(rawBody: string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string): VerifiedWebhookEvent | null {
    const expected = this.signWebhookPayload(rawBody);
    if (signatureHeader !== expected) return null; // forged/corrupted signature — reject, never process

    try {
      const parsed = JSON.parse(rawBody) as { id?: unknown; type?: unknown; data?: unknown };
      if (typeof parsed.id !== 'string' || typeof parsed.type !== 'string') return null;
      return { eventId: parsed.id, eventType: parsed.type, payload: parsed.data };
    } catch {
      return null; // malformed JSON body — reject, never crash
    }
  }
}

let cachedProvider: BillingProvider | null = null;

/**
 * Single choke point, mirroring provider-router.ts's getAIProvider()
 * pattern exactly. `stripe-billing-provider.ts` only imports TYPES from
 * this file (erased at compile time) — no real runtime circularity.
 */
export function getBillingProvider(): BillingProvider {
  if (env.PAYMENT_PROVIDER === 'stripe') {
    return getStripeBillingProvider();
  }
  cachedProvider ??= new MockBillingProvider();
  return cachedProvider;
}

export function resetBillingProviderForTests(): void {
  cachedProvider = null;
}
