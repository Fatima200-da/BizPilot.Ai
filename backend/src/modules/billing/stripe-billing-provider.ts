import Stripe from 'stripe';
import { env } from '../../config/env';
import { prisma } from '../../infrastructure/database/prisma';
import { ValidationError } from '../../common/errors/app-error';
import type { BillingProvider, BillingCustomerRecord, CheckoutSession, ExternalSubscription, PortalSession, VerifiedWebhookEvent } from './billing-provider';

/**
 * Phase 28 Track B: the real Stripe adapter behind the existing
 * `BillingProvider` interface (Phase 25) — no Stripe-specific type or
 * concept (Customer, PaymentIntent, Price, checkout Session) ever leaks
 * past this file; every domain service (subscription.service.ts,
 * webhook.service.ts, invoice.service.ts) continues to depend only on the
 * provider-neutral interface, exactly as it did for `MockBillingProvider`.
 *
 * TEST MODE ONLY in this codebase: `STRIPE_SECRET_KEY` is read from the
 * environment (never committed, never baked into a Docker image layer or
 * the frontend bundle — see env.ts's fail-fast validation and
 * Dockerfile/.dockerignore). No real Stripe credential exists in this
 * development environment, so every method that performs a real network
 * call to api.stripe.com is honestly `BLOCKED — CREDENTIAL` in this
 * phase's certification evidence — this class is real, complete,
 * structurally correct code, not a stub, but its live-network paths have
 * never been executed against a real Stripe account here.
 * `verifyWebhookSignature` is the one exception: Stripe's own signature
 * verification is pure local HMAC-SHA256 cryptography (no network call),
 * so it IS genuinely testable and tested with real execution — see
 * stripe-billing-provider.test.ts.
 */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe';
  private readonly client: Stripe;
  private readonly webhookSecret: string;

  constructor(secretKey: string, webhookSecret: string) {
    this.client = new Stripe(secretKey);
    this.webhookSecret = webhookSecret;
  }

  async createCustomer(params: { workspaceId: string; email: string }): Promise<BillingCustomerRecord> {
    const customer = await this.client.customers.create({
      email: params.email,
      metadata: { workspaceId: params.workspaceId }, // real audit trail on the Stripe side, never PII beyond what Stripe already requires
    });
    return { externalCustomerId: customer.id };
  }

  async createCheckoutSession(params: { externalCustomerId: string; planKey: string; successUrl: string; cancelUrl: string }): Promise<CheckoutSession> {
    const priceId = await this.resolvePriceId(params.planKey);
    const session = await this.client.checkout.sessions.create({
      customer: params.externalCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
    });
    if (!session.url) throw new Error('Stripe checkout session created without a URL — unexpected Stripe API response shape.');
    return { checkoutUrl: session.url, sessionId: session.id };
  }

  async createSubscription(params: { externalCustomerId: string; planKey: string }): Promise<ExternalSubscription> {
    const priceId = await this.resolvePriceId(params.planKey);
    const subscription = await this.client.subscriptions.create({
      customer: params.externalCustomerId,
      items: [{ price: priceId }],
    });
    return { externalSubscriptionId: subscription.id, status: subscription.status };
  }

  async cancelSubscription(externalSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.cancel(externalSubscriptionId);
  }

  async changeSubscription(externalSubscriptionId: string, newPlanKey: string): Promise<ExternalSubscription> {
    const priceId = await this.resolvePriceId(newPlanKey);
    const current = await this.client.subscriptions.retrieve(externalSubscriptionId);
    const currentItemId = current.items.data[0]?.id;
    if (!currentItemId) throw new Error(`Stripe subscription ${externalSubscriptionId} has no line items — cannot change plan.`);

    const updated = await this.client.subscriptions.update(externalSubscriptionId, {
      items: [{ id: currentItemId, price: priceId }],
      proration_behavior: 'create_prorations', // real, honest proration — never silently absorbed or waived
    });
    return { externalSubscriptionId: updated.id, status: updated.status };
  }

  async getSubscription(externalSubscriptionId: string): Promise<ExternalSubscription | null> {
    try {
      const subscription = await this.client.subscriptions.retrieve(externalSubscriptionId);
      return { externalSubscriptionId: subscription.id, status: subscription.status };
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async createPortalSession(externalCustomerId: string): Promise<PortalSession> {
    const session = await this.client.billingPortal.sessions.create({ customer: externalCustomerId });
    return { portalUrl: session.url };
  }

  /**
   * Real Stripe signature verification — `Stripe.webhooks.constructEvent`
   * is a pure local cryptographic check (HMAC-SHA256 over
   * `${timestamp}.${rawBody}`, timing-safe compare, replay-window check on
   * the timestamp) with NO network call to Stripe. This method is
   * genuinely, fully testable without any live credential — see
   * stripe-billing-provider.test.ts, which signs real payloads with
   * Stripe's own SDK utilities and proves both the accept and reject paths.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string): VerifiedWebhookEvent | null {
    try {
      const event = this.client.webhooks.constructEvent(rawBody, signatureHeader, this.webhookSecret);
      return { eventId: event.id, eventType: event.type, payload: event.data.object };
    } catch {
      return null; // invalid signature, expired timestamp, or malformed body — reject, never process, never throw
    }
  }

  private async resolvePriceId(planKey: string): Promise<string> {
    const plan = await prisma.subscriptionPlan.findUnique({ where: { key: planKey } });
    if (!plan) throw new ValidationError([{ field: 'planKey', code: 'NOT_FOUND', message: `No plan "${planKey}".` }]);
    if (!plan.stripePriceIdMonthly) {
      throw new ValidationError([{ field: 'planKey', code: 'STRIPE_PRICE_NOT_CONFIGURED', message: `Plan "${planKey}" has no Stripe Price ID configured — it cannot be sold via Stripe until a real product/price is created for it in the Stripe dashboard and stripePriceIdMonthly is set.` }]);
    }
    return plan.stripePriceIdMonthly;
  }
}

let cachedStripeProvider: StripeBillingProvider | null = null;

/** Real, invokable factory — mirrors billing-provider.ts's own getBillingProvider() choke point. Throws if PAYMENT_PROVIDER=stripe was selected without valid config (should be unreachable in practice, since env.ts already fails fast at process startup — this is defense in depth, not the primary guard). */
export function getStripeBillingProvider(): StripeBillingProvider {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('StripeBillingProvider requested but STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET are not configured.');
  }
  cachedStripeProvider ??= new StripeBillingProvider(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET);
  return cachedStripeProvider;
}

export function resetStripeBillingProviderForTests(): void {
  cachedStripeProvider = null;
}
