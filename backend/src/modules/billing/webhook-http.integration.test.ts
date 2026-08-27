import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../testing/integration-helpers';
import { prisma } from '../../infrastructure/database/prisma';
import { MockBillingProvider } from './billing-provider';

/**
 * Phase 28 Track B Section 5: the real HTTP webhook endpoint
 * (`POST /api/v1/webhooks/stripe`, webhook.routes.ts), never wired to any
 * route before this phase. Exercises the actual raw-body Express plumbing
 * end to end — this is the piece that specifically breaks if a provider's
 * signature is checked against a re-serialized `JSON.stringify(req.body)`
 * instead of the true raw bytes, which is exactly why this route is
 * mounted before the global `express.json()` parser (app.ts).
 *
 * `env.PAYMENT_PROVIDER=mock` in this environment (no real Stripe
 * credential — see stripe-billing-provider.test.ts and
 * stripe-webhook-idempotency.integration.test.ts for the real Stripe SDK
 * coverage at the function level), so `getBillingProvider()` resolves to
 * `MockBillingProvider` here — this file proves the HTTP ROUTE's raw-body
 * wiring and status-code mapping are correct, using the same real
 * verification code path `processWebhook` always uses, regardless of
 * which concrete provider is behind it.
 */
describe('POST /api/v1/webhooks/stripe (integration, real HTTP + raw body)', () => {
  const provider = new MockBillingProvider();
  const runId = randomUUID().slice(0, 8);

  it('a validly-signed event returns 200 and is recorded as PROCESSED — the raw body Express delivered matches exactly what was signed', async () => {
    const rawBody = JSON.stringify({ id: `evt_http_valid_${runId}`, type: 'some.unrecognized.event.type', data: {} });
    const signature = provider.signWebhookPayload(rawBody);

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(rawBody);

    expect(res.status).toBe(200);
    const body = res.body as { received: boolean; outcome: string };
    expect(body.received).toBe(true);

    const stored = await prisma.webhookEvent.findUniqueOrThrow({ where: { provider_externalEventId: { provider: 'STRIPE', externalEventId: `evt_http_valid_${runId}` } } });
    expect(stored.status).toBe('PROCESSED');
  });

  it('an invalid signature returns a real 400, and nothing is ever recorded', async () => {
    const rawBody = JSON.stringify({ id: `evt_http_invalid_${runId}`, type: 'some.event', data: {} });

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'not-a-real-signature')
      .send(rawBody);

    expect(res.status).toBe(400);
    const stored = await prisma.webhookEvent.findFirst({ where: { externalEventId: `evt_http_invalid_${runId}` } });
    expect(stored).toBeNull();
  });

  it('a missing stripe-signature header is rejected with 400, never crashes the process', async () => {
    const rawBody = JSON.stringify({ id: `evt_http_no_header_${runId}`, type: 'some.event', data: {} });

    const res = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').send(rawBody);

    expect(res.status).toBe(400);
  });

  it('DUPLICATE delivery of the same real event over real HTTP returns 200 both times, and is recorded exactly once — a provider retrying after a slow-but-successful first response must never be treated as an error', async () => {
    const rawBody = JSON.stringify({ id: `evt_http_duplicate_${runId}`, type: 'some.event', data: {} });
    const signature = provider.signWebhookPayload(rawBody);

    const first = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(rawBody);
    expect(first.status).toBe(200);

    const second = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(rawBody);
    expect(second.status).toBe(200);
    expect((second.body as { outcome: string }).outcome).toBe('duplicate');

    const rows = await prisma.webhookEvent.findMany({ where: { externalEventId: `evt_http_duplicate_${runId}` } });
    expect(rows).toHaveLength(1);
  });

  it('this route is reachable with NO authentication — a real webhook has no user session, and requiring one would make it permanently unreachable by the real provider', async () => {
    const rawBody = JSON.stringify({ id: `evt_http_no_auth_${runId}`, type: 'some.event', data: {} });
    const signature = provider.signWebhookPayload(rawBody);

    const res = await request(app).post('/api/v1/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', signature).send(rawBody);
    expect(res.status).not.toBe(401); // never gated behind authenticate — verified via the real signature instead
  });
});
