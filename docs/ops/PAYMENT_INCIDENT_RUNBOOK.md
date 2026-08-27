# Payment Incident Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** Stripe/billing/subscription/webhook incidents. Read [`INCIDENT_RESPONSE_RUNBOOK.md`](INCIDENT_RESPONSE_RUNBOOK.md) first for severity/escalation basics.

## Honest current status: `BLOCKED — CREDENTIAL`

As of this writing, no real Stripe account is credentialed in this environment — `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PUBLISHABLE_KEY` are all unset in `.env` (confirmed via direct inspection, not assumption). `PAYMENT_PROVIDER` defaults to `mock`. **This runbook describes the real, built payment-handling code paths and how to operate them once real Stripe credentials are provisioned — it does not certify that a real Stripe integration has been exercised end-to-end against genuine Stripe infrastructure.** Before relying on this system for real customer billing, provision real Stripe credentials (test mode first) and run one real, complete subscription lifecycle (create → webhook received → `Subscription` row updated → invoice/payment recorded) end-to-end, then repeat for a real failure case (declined card, webhook replay, webhook signature mismatch).

## Startup validation (already real, already enforced)

`backend/src/config/env.ts` validates, at process startup, that if `PAYMENT_PROVIDER=stripe`: `STRIPE_SECRET_KEY` is present and starts with `sk_`, `STRIPE_WEBHOOK_SECRET` is present and starts with `whsec_`, and — critically — that a `sk_test_...` key is never used in `NODE_ENV=production` and a `sk_live_...` key is never used outside production. This is a real, structural guardrail against the single most common real-world Stripe misconfiguration (accidentally running production traffic against test-mode keys or vice versa) — the app refuses to boot rather than silently misbehaving.

## What to check first

1. `GET /admin/alerts` for a real `payment_webhook_failure`-class alert (Phase 33 Track F) if one has been wired into `alerting.service.ts` for the current webhook handler's failure signal.
2. Your real Stripe Dashboard's own webhook delivery log (once credentialed) — Stripe's own retry/delivery status is the authoritative source for whether a webhook was sent and how the endpoint responded.
3. Real `AuditLog` / `Subscription` / `Invoice` / `Payment` rows for the affected workspace — these tables have NO `deletedAt` column (confirmed structurally in Phase 33's data-retention work: they are exempt from ANY automated purge by construction, not policy) — so the full real history is always present for investigation, never silently aged out.

## Scenario: webhook signature verification failing

A webhook that fails signature verification is correctly rejected, not processed — this protects against a forged event claiming a payment succeeded when it didn't. If ALL webhooks are suddenly failing verification: check that `STRIPE_WEBHOOK_SECRET` matches the secret for the SPECIFIC webhook endpoint configured in the Stripe Dashboard (each endpoint has its own secret — a redeploy that changes the endpoint URL without updating the secret is the most common real cause).

## Scenario: webhook received but processing failed

Because Stripe retries failed webhook deliveries automatically (their own real, built-in retry with backoff), a transient processing failure (e.g. a momentary DB outage) is usually self-healing on Stripe's next retry — do not assume you must manually replay it immediately. If it is NOT self-healing after a reasonable window, use Stripe's Dashboard to manually resend the specific event, and verify the resulting `Subscription`/`Invoice`/`Payment` state directly against the DB afterward.

## Scenario: webhook replay / idempotency concern

Checkout order idempotency was hardened in a prior phase (see the `feat: integrate checkout order idempotency` commit) — a webhook processed twice for the same real event should not double-charge a credit ledger or double-create a subscription record. If you suspect a double-processing incident, verify by real row inspection (duplicate `Payment` rows for the same Stripe event ID would be the concrete symptom) rather than assuming the idempotency guard held — confirm it.

## Escalation

A confirmed double-charge, a confirmed subscription in the wrong state relative to what the customer actually paid for, or any real customer-facing billing discrepancy is at minimum SEV2 (real financial/trust impact even if no data was lost) — follow `INCIDENT_RESPONSE_RUNBOOK.md`'s postmortem requirement regardless of how quickly it's resolved.
