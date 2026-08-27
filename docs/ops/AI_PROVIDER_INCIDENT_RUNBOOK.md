# AI Provider Incident Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** AI provider (OpenAI) outages, timeouts, and credit-charging anomalies. Read [`INCIDENT_RESPONSE_RUNBOOK.md`](INCIDENT_RESPONSE_RUNBOOK.md) first for severity/escalation basics.

## Honest current status: `BLOCKED — CREDENTIAL`

As of this writing, `OPENAI_API_KEY` is present in `.env` but genuinely empty (confirmed via direct byte-level inspection, not merely "unset") — `AI_PROVIDER` defaults to `mock`. **This runbook describes the real, built provider-router architecture and the invariant it must uphold once real credentials are provisioned — it does not certify a real OpenAI integration has been exercised end-to-end against genuine OpenAI infrastructure.** Before relying on this system for real AI usage billing, provision a real `OPENAI_API_KEY`, set `AI_PROVIDER=openai`, and run one real, complete AI operation end-to-end while directly verifying the credit-ledger invariant below.

## The one invariant that matters most

**1 logical AI operation = at most 1 credit charge.** This must hold even under retry, even under a provider timeout that later turns out to have actually succeeded server-side, and even under a duplicate/replayed request. The credit-ledger TOCTOU race found and fixed in Phase 30 (`docs/PHASE_30_PRODUCTION_HARDENING_CERTIFICATION.md`) is the concrete historical example of this invariant being violated and then structurally closed — if a future incident looks like a double-charge, start by re-reading that fix and confirming it's still in place (`git log -p` on the credit-ledger service around that period), rather than assuming a new bug.

## Real architecture (already built, already tested with the mock adapter)

`backend/src/infrastructure/ai/` — `ai-provider.port.ts` defines the real `AIProviderPort` interface; `mock-provider.adapter.ts` is the honest mock (used whenever `AI_PROVIDER=mock`, which is a deliberate, supported, documented production mode — not a stub to be embarrassed about); `provider-router.ts` selects the real adapter (`openai.adapter.ts` for `AI_PROVIDER=openai`) based on `env.AI_PROVIDER`. `openai.adapter.ts` is real code written against the real OpenAI SDK shape — it has been type-checked and unit-exercised against the port contract, but not yet exercised against genuine OpenAI infrastructure in this environment (no credential).

## What to check first

1. `GET /admin/alerts` for an `ai_provider_failure`-class alert — `alerting.service.ts` reads the real `ai_failures_total` / `ai_requests_total` counters from `backend/src/common/observability/metrics.ts` (populated by `recordAiRequest()` on every real AI call) to compute a genuine failure rate, not a guess.
2. Real `AIUsage` rows for the affected workspace (`actionType`, `status`, `creditsConsumed`, `modelProvider`, `modelName`, `createdAt`) — this is the ground truth for "what actually got charged," independent of what the provider's own dashboard shows.
3. The real OpenAI status page / your OpenAI dashboard (once credentialed) for a provider-side outage — do not assume the failure is internal before checking whether the dependency itself is down.

## Scenario: AI provider is timing out or erroring

If `ai_provider_failure` fires (from a real, measured elevated `ai_failures_total` rate): first determine if this is graceful (the app should degrade — return a real, honest error to the user, NOT silently charge a credit for a failed operation) or if credits are being consumed despite failures. The latter is a real defect matching the invariant above — reproduce it, find the exact code path where a charge is recorded before/without confirming genuine success, and fix it with the same discipline as the Phase 30 fix (a real regression test proving the specific failure mode is closed).

## Scenario: suspected double-charge

Query `AIUsage` for the affected workspace/action and look for two rows with the same real business intent (same user, same action type, timestamps within the same request/retry window) each carrying a real `creditsConsumed` charge. If found, this is the invariant violated — treat it as at minimum SEV2, credit the workspace back the erroneous charge (a real, auditable correcting entry, not a silent row edit), and add a regression test reproducing the exact retry/timeout condition that caused it before closing the incident.

## Escalation

A credit-ledger invariant violation (double-charge, or charge-without-service) is a direct financial/trust issue even though no data was lost — treat it as at least SEV2 per `INCIDENT_RESPONSE_RUNBOOK.md`, with a mandatory postmortem.
