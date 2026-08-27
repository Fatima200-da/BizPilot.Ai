import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { StripeBillingProvider } from './stripe-billing-provider';

/**
 * Phase 28 Track B Section 5: real Stripe webhook signature verification —
 * genuinely executed, not fabricated. `Stripe.webhooks.constructEvent` (and
 * the SDK's own `generateTestHeaderString` testing utility used here to
 * produce REAL, validly-signed payloads) are pure local HMAC-SHA256
 * cryptography with NO network call to api.stripe.com, so this is fully
 * testable without any live Stripe credential — the one genuinely
 * credential-free real-execution surface of the whole Stripe integration.
 * The secret key passed to the constructor is never used by any of these
 * tests (no network call is made), only the webhook secret matters here.
 */
const WEBHOOK_SECRET = 'whsec_test_secret_for_local_signature_testing_only_never_a_real_key';

function makeProvider(): StripeBillingProvider {
  return new StripeBillingProvider('sk_test_unused_in_these_tests', WEBHOOK_SECRET);
}

function signedPayload(body: Record<string, unknown>, secret = WEBHOOK_SECRET): { payload: string; header: string } {
  const payload = JSON.stringify(body);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

describe('StripeBillingProvider.verifyWebhookSignature (real Stripe SDK cryptography)', () => {
  it('accepts a genuinely, validly-signed payload and extracts the real event id/type/data', () => {
    const provider = makeProvider();
    const { payload, header } = signedPayload({
      id: 'evt_real_signature_test',
      type: 'invoice.payment_succeeded',
      data: { object: { workspaceId: 'ws_123' } },
    });

    const result = provider.verifyWebhookSignature(payload, header);
    expect(result).not.toBeNull();
    expect(result?.eventId).toBe('evt_real_signature_test');
    expect(result?.eventType).toBe('invoice.payment_succeeded');
    expect(result?.payload).toEqual({ workspaceId: 'ws_123' });
  });

  it('rejects a payload signed with the WRONG webhook secret — a forged signature', () => {
    const provider = makeProvider();
    const { payload, header } = signedPayload(
      { id: 'evt_wrong_secret', type: 'invoice.payment_succeeded', data: { object: {} } },
      'whsec_a_completely_different_secret_the_attacker_does_not_have'
    );

    const result = provider.verifyWebhookSignature(payload, header);
    expect(result).toBeNull(); // never throws, never processes — a clean reject
  });

  it('rejects a payload whose BODY was tampered with after signing (signature no longer matches)', () => {
    const provider = makeProvider();
    const { payload, header } = signedPayload({ id: 'evt_tamper_test', type: 'invoice.payment_succeeded', data: { object: { amount: 100 } } });

    // A real attacker modifying the body in transit — the signature was
    // computed over the ORIGINAL body and will not match this one.
    const tamperedPayload = payload.replace('"amount":100', '"amount":999999');

    const result = provider.verifyWebhookSignature(tamperedPayload, header);
    expect(result).toBeNull();
  });

  it('rejects a malformed/garbage signature header without throwing', () => {
    const provider = makeProvider();
    const { payload } = signedPayload({ id: 'evt_garbage_header', type: 'invoice.payment_succeeded', data: { object: {} } });

    expect(() => {
      const result = provider.verifyWebhookSignature(payload, 'not-a-real-stripe-signature-header-at-all');
      expect(result).toBeNull();
    }).not.toThrow();
  });

  it('rejects an empty signature header', () => {
    const provider = makeProvider();
    const { payload } = signedPayload({ id: 'evt_empty_header', type: 'invoice.payment_succeeded', data: { object: {} } });

    const result = provider.verifyWebhookSignature(payload, '');
    expect(result).toBeNull();
  });

  it('rejects a signature whose timestamp is outside Stripe\'s real replay-protection tolerance window (a genuine anti-replay check, not simulated)', () => {
    const provider = makeProvider();
    const payload = JSON.stringify({ id: 'evt_replay_test', type: 'invoice.payment_succeeded', data: { object: {} } });
    // A real, correctly-signed header — but for a timestamp 10 minutes in
    // the past, well outside constructEvent's default 300-second tolerance.
    const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET, timestamp: staleTimestamp });

    const result = provider.verifyWebhookSignature(payload, header);
    expect(result).toBeNull(); // the signature math is genuinely valid, but Stripe's own replay-window check genuinely rejects it
  });

  it('rejects malformed JSON in an otherwise correctly-signed body, without crashing', () => {
    const provider = makeProvider();
    const payload = '{not valid json at all';
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    expect(() => {
      const result = provider.verifyWebhookSignature(payload, header);
      expect(result).toBeNull();
    }).not.toThrow();
  });

  it('two different, correctly-signed events produce two different, correctly-extracted event ids — proving this is real per-payload verification, not a hardcoded accept', () => {
    const provider = makeProvider();
    const first = signedPayload({ id: 'evt_first', type: 'customer.subscription.deleted', data: { object: {} } });
    const second = signedPayload({ id: 'evt_second', type: 'invoice.payment_failed', data: { object: {} } });

    expect(provider.verifyWebhookSignature(first.payload, first.header)?.eventId).toBe('evt_first');
    expect(provider.verifyWebhookSignature(second.payload, second.header)?.eventId).toBe('evt_second');
    expect(provider.verifyWebhookSignature(first.payload, first.header)?.eventType).toBe('customer.subscription.deleted');
    expect(provider.verifyWebhookSignature(second.payload, second.header)?.eventType).toBe('invoice.payment_failed');

    // Cross-wired: event A's real signature never validates event B's body.
    expect(provider.verifyWebhookSignature(second.payload, first.header)).toBeNull();
  });
});
