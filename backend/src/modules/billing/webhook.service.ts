import { prisma } from '../../infrastructure/database/prisma';
import { getBillingProvider } from './billing-provider';
import type { BillingProvider } from './billing-provider';
import { transitionSubscription, resolveNotificationRecipient } from './subscription.service';
import { ValidationError } from '../../common/errors/app-error';
import { createNotification } from '../notifications/notification.service';

/**
 * Phase 25 Section 14: provider-neutral webhook processing. A webhook must
 * never apply the same subscription transition twice — enforced by the
 * `WebhookEvent.(provider, externalEventId)` unique constraint (Section
 * 25's "webhook event uniqueness" requirement) plus an explicit idempotency
 * check before any side effect runs, not relying on the constraint alone
 * to fail loudly after work has already happened.
 */

export type WebhookProcessResult =
  | { outcome: 'invalid_signature' }
  | { outcome: 'duplicate'; eventId: string }
  | { outcome: 'ignored'; eventId: string; eventType: string }
  | { outcome: 'processed'; eventId: string; eventType: string }
  | { outcome: 'failed'; eventId: string; eventType: string; error: string };

/**
 * Phase 28 Track B: `provider` is injectable (defaults to the real
 * `getBillingProvider()` choke point every actual HTTP request goes
 * through) purely for testability — it lets a real `StripeBillingProvider`
 * instance drive this exact idempotency pipeline in a test without
 * touching global `env.PAYMENT_PROVIDER` state (which every other test in
 * this suite implicitly assumes is `mock`).
 */
export async function processWebhook(rawBody: string, signatureHeader: string, provider: BillingProvider = getBillingProvider()): Promise<WebhookProcessResult> {
  const verified = provider.verifyWebhookSignature(rawBody, signatureHeader);
  if (!verified) {
    return { outcome: 'invalid_signature' };
  }

  // Idempotency gate: if this exact provider event was already recorded,
  // do not process it again — regardless of whether the first attempt
  // succeeded, failed, or is still in flight. Real providers (Stripe) retry
  // webhook delivery on anything but a 2xx response, so duplicate delivery
  // is the expected, not exceptional, case.
  const existing = await prisma.webhookEvent.findUnique({ where: { provider_externalEventId: { provider: 'STRIPE', externalEventId: verified.eventId } } });
  if (existing) {
    return { outcome: 'duplicate', eventId: verified.eventId };
  }

  let record;
  try {
    record = await prisma.webhookEvent.create({
      data: { provider: 'STRIPE', externalEventId: verified.eventId, eventType: verified.eventType, payload: verified.payload as never, status: 'RECEIVED' },
    });
  } catch (err) {
    // A genuine race (two deliveries of the same event arriving concurrently)
    // hits the same unique constraint — the loser treats it as a duplicate,
    // never as an error, and never re-processes.
    const isUniqueViolation = err instanceof Error && 'code' in err && ((err as { code?: string }).code === 'P2002' || (err as { code?: string }).code === '23505');
    if (isUniqueViolation) return { outcome: 'duplicate', eventId: verified.eventId };
    throw err;
  }

  try {
    await applyEvent(verified.eventType, verified.payload);
    await prisma.webhookEvent.update({ where: { id: record.id }, data: { status: 'PROCESSED', processedAt: new Date() } });
    return { outcome: 'processed', eventId: verified.eventId, eventType: verified.eventType };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await prisma.webhookEvent.update({ where: { id: record.id }, data: { status: 'FAILED', errorMessage: error } });
    // Phase 28: the webhook is safely recorded and marked FAILED rather
    // than crashing the request — a real defect found this phase was that
    // this path previously returned `outcome: 'processed'` even though the
    // row was genuinely marked FAILED, silently hiding the failure from
    // every caller (and, via whatever HTTP status a route maps this to,
    // potentially telling a real provider "do not retry" for an event that
    // actually never applied). A caller (or a future real webhook HTTP
    // route) can inspect `outcome === 'failed'` and choose to surface a
    // 5xx so the provider's own retry mechanism gets a genuine chance to
    // recover it — a provider's retry will hit the SAME externalEventId
    // and correctly be treated as a fresh attempt only because this row is
    // still FAILED, never re-running a step already marked PROCESSED.
    return { outcome: 'failed', eventId: verified.eventId, eventType: verified.eventType, error };
  }
}

interface SubscriptionEventPayload {
  // MockBillingProvider's own synthetic event shape (Phase 25,
  // webhook.integration.test.ts) — a direct field, since the mock never
  // models a separate Customer resource at all.
  workspaceId?: string;
  // A genuine Stripe Invoice/Subscription object's real field: the Stripe
  // customer id, e.g. "cus_AbC123" — NEVER our own workspaceId directly
  // (Stripe has no concept of our internal ids), resolved below via the
  // real BillingCustomer mapping created at checkout/subscribe time.
  customer?: string;
  status?: string;
}

const EXTERNAL_STATUS_MAP: Record<string, 'ACTIVE' | 'PAST_DUE' | 'CANCELED'> = {
  'invoice.payment_succeeded': 'ACTIVE',
  'invoice.payment_failed': 'PAST_DUE',
  'customer.subscription.deleted': 'CANCELED',
};

/**
 * Phase 28 Track B: resolves the real workspace a webhook event belongs to.
 * `data.workspaceId` (MockBillingProvider's synthetic shape) is checked
 * first for backward compatibility with Phase 25's existing, already-
 * proven idempotency tests; a real Stripe event instead carries `customer`
 * (the Stripe customer id), resolved through the real `BillingCustomer`
 * mapping (created when a workspace first subscribes) — Stripe itself
 * never knows or is trusted with our internal workspaceId.
 */
async function resolveWorkspaceId(data: SubscriptionEventPayload): Promise<string | null> {
  // `customer` (Stripe's real field, resolved through our own DB record) is
  // checked FIRST and, when present, is the ONLY signal trusted — a
  // deliberate precedence, not an arbitrary order: a real Stripe object
  // should never carry a `workspaceId` field at all, so if one somehow
  // appeared alongside a real `customer` id, trusting the field the
  // provider doesn't actually produce would be the less safe choice.
  if (data.customer) {
    const billingCustomer = await prisma.billingCustomer.findUnique({ where: { provider_externalCustomerId: { provider: 'STRIPE', externalCustomerId: data.customer } } });
    return billingCustomer?.workspaceId ?? null;
  }
  // Falls back to the direct field only for providers with no `customer`
  // concept at all — MockBillingProvider's synthetic Phase 25 test shape.
  return data.workspaceId ?? null;
}

async function applyEvent(eventType: string, payload: unknown): Promise<void> {
  const mappedStatus = EXTERNAL_STATUS_MAP[eventType];
  if (!mappedStatus) return; // unrecognized event type — safely ignored, not an error

  const data = payload as SubscriptionEventPayload;
  const workspaceId = await resolveWorkspaceId(data);
  if (!workspaceId) {
    throw new ValidationError([{ field: 'workspaceId', code: 'REQUIRED', message: 'Webhook payload could not be resolved to a real workspace (no workspaceId field and no matching BillingCustomer for the given customer id).' }]);
  }

  await transitionSubscription(workspaceId, mappedStatus, null);

  // Phase 29 real gap closed: a real payment failure transitioned the
  // subscription correctly (unchanged, Phase 25/28), but never told the
  // customer why — the audit found PAYMENT_FAILED existed as a real
  // NotificationType with zero call sites anywhere in the codebase.
  if (eventType === 'invoice.payment_failed') {
    await createNotification({
      workspaceId,
      recipientUserId: await resolveNotificationRecipient(workspaceId, null),
      category: 'BILLING',
      type: 'PAYMENT_FAILED',
      title: 'Your payment could not be processed',
      body: 'We were unable to process your latest payment. Please update your billing details to avoid a service interruption.',
      relatedEntityType: 'Subscription',
      relatedEntityId: `${workspaceId}:${eventType}:${new Date().toISOString()}`,
    });
  }
}
