# Phase 24 — AI Platform Hardening, Billing Integrity & Provider Readiness Certification

Every gate below is based on actual command execution against a real PostgreSQL 18 database, real Docker containers built and run this phase, and real HTTP requests through the real Express application — never on Dockerfile/CI inspection or provider simulation claimed as live behavior. `REAL_AI_PROVIDER` is `BLOCKED — CREDENTIAL` throughout this document; nothing here claims otherwise.

## 1. Executive Summary

Phase 24 audited the complete AI request pipeline end to end and found **one real, previously-undiscovered billing-integrity defect**: AI-bearing workflow steps deducted credits *before* calling the provider, and the workflow engine retries a failed step's entire handler (including the credit deduction) up to 3 times — so a transient provider failure that eventually succeeded, or one that exhausted retries, could charge a workspace 2-3x for one logical action. This was fixed by splitting the credit-ledger into a read-only pre-flight check (before the provider call) and a charge that only happens after a successful, validated response. A second, smaller finding — the OpenAI adapter relayed raw third-party SDK error text directly into a client-facing error message — was also fixed (now logged server-side only; the client gets a generic message).

Both fixes are proven correct by new tests run against the real database and, for the billing fix, inside a freshly-built real Docker container. 20 new tests were added across input validation, exactly-once billing (including a genuine concurrent-request race that was made to happen and recover correctly), tenant isolation, rate limiting, and local performance measurement — all passing. The full regression suite was re-run and shows zero regressions: 60/60 unit (was 48), 76/76 integration on real Postgres (was 49), 76/76 on PGlite, 9/9 Playwright E2E.

`REAL_AI_PROVIDER` remains `BLOCKED — CREDENTIAL` — no `OPENAI_API_KEY` exists anywhere in this session (confirmed via `env`, PowerShell environment enumeration, full git history scan, and source-tree scan — all clean). Every gate that does not require a live provider credential is `VERIFIED` through real execution.

## 2. Certified Phase 23 Baseline (not reopened)

Phase 23 closed with 20/20 production deployment gates VERIFIED via real Docker execution: build, runtime, database connectivity, migrations/seed, core business flow, concurrency, tenant isolation, production HTTP/Nginx, authentication, 9/9 Playwright against real containers, restart/persistence, security, stability, failure injection, and rollback. This phase treats that as ground truth and only re-touches it where a Phase 24 code change could plausibly affect it (the credit-ledger and OpenAI-adapter changes) — see Section 20.

## 3. Scope

In scope: the AI request pipeline (input validation → auth → workspace resolution → credit check → provider call → output validation → billing → persistence), the credit ledger, the provider abstraction, error classification, rate limiting, tenant isolation for AI data, Docker AI-configuration behavior, and local performance characteristics. Out of scope, and explicitly not fabricated: anything requiring a live call to `api.openai.com`.

## 4. Architecture Audit

Full trace written to [`docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md`](PHASE_24_AI_ARCHITECTURE_AUDIT.md) before any code was changed, per this phase's own instruction. Confirmed structure: `AIProviderPort` (hexagonal interface) → `provider-router.ts` (single choke point, `MeteredProviderPort` wrapper) → `MockProviderAdapter` / `OpenAIAdapter`. Confirmed: no module outside `infrastructure/ai/` and `infrastructure/openai/` imports a concrete adapter. Confirmed: `AICredit`/`AIUsage` are scoped by `workspaceId` in every query, with no code path accepting an externally-supplied `workspaceId` for ledger operations (always derived from the authenticated JWT).

## 5. Defects Found

1. **Credit double/triple-charging on transient AI retry** (HIGH). `marketing-autopilot.steps.ts`'s three AI-bearing steps called `recordUsage()` (deduct) before `provider.complete()`. `runStepWithRetry` retries the whole handler up to 3x on `UpstreamProviderError`, so each retry re-deducted credits for what the business considers one action.
2. **Third-party SDK error text relayed to the client**. `openai.adapter.ts`'s catch block built `UpstreamProviderError`'s message (client-facing `detail` field) directly from the OpenAI SDK's raw error message — not a secret leak today, but an unvetted trust boundary (SDK error text is not a contract this app controls).

## 6. Defects Fixed

1. Added `assertSufficientCredits()` (read-only balance check, no write) to `credit-ledger.service.ts`. Updated all three AI steps in `marketing-autopilot.steps.ts` to call it *before* `provider.complete()`, and call the existing `recordUsage()` (now charge-only-after-success) only after the provider response is parsed and schema-validated. Result: exactly one charge per logical action, regardless of retry count.
2. `openai.adapter.ts`'s catch block now logs the real SDK error server-side (`console.error`, with `promptKey`/`workspaceId`, never the key) and throws `UpstreamProviderError()` with its safe default message — the client never sees third-party error text.

Both fixes are proven by new tests (Sections 9, 15) run against the real database, and the billing fix additionally proven inside a freshly built real Docker container (Section 20).

## 7. Input Validation

`marketing-autopilot-input-validation.integration.test.ts` — 14 real HTTP tests against `POST /workspaces/:id/workflows/marketing-autopilot`: empty body, missing field, wrong type, invalid UUID, 500-item array (over max), non-array where array required, extra field (safely stripped, not rejected — the schema's existing contract), invalid enum, whitespace-only UUID, empty array, boundary (exactly 5 platforms, accepted) and one-over-boundary (6, rejected), malformed raw JSON body (rejected by body-parser before reaching schema validation), and an explicit proof that a rejected request creates zero `WorkflowInstance`/`AIUsage` rows. Confirmed via middleware ordering (`authorize` → `workflowExecutionRateLimit` → `validateBody` → handler) that validation always precedes any credit check or provider work.

**Command**: `npx vitest run --config vitest.integration.config.ts src/modules/marketing-autopilot/marketing-autopilot-input-validation.integration.test.ts` → **14/14 passed**.

## 8. Output Validation

`marketing-autopilot.schemas.test.ts` — 11 unit tests against the real Zod schemas every AI response is validated against: valid, empty object, empty-string JSON.parse (catchable `SyntaxError`, not an uncaught crash), malformed JSON (same), missing required field, extra field (safely stripped per the existing Zod object contract — determined, not assumed), below-minimum array, above-maximum array (oversized, rejected not truncated), wrong field type (not coerced), provider-refusal-shaped string, and `null`. A companion integration test (`workflow-failure.integration.test.ts`, new case) drives a raw `SyntaxError` through the real `runStepWithRetry` engine and confirms it is classified as a **permanent** failure (not retried, since `isTransientError` only matches `UpstreamProviderError`/`AbortError`/timeout-like messages) — one attempt, `FAILED`, process alive throughout.

**Commands**: `npx vitest run src/modules/marketing-autopilot/marketing-autopilot.schemas.test.ts` → **11/11**; `npx vitest run --config vitest.integration.config.ts src/modules/workflows/workflow-failure.integration.test.ts` → **4/4** (was 3, +1 malformed-JSON case).

## 9. Billing Integrity (HIGH-PRIORITY)

`credit-charge-ordering.integration.test.ts` (3 tests, direct engine-level): a transient-then-succeeds sequence (fails twice, succeeds on attempt 3) charges **exactly once**, not 3x, verified via `getBalance()` before/after against the real database; a permanently-failing sequence (exhausts all 3 attempts) is **never charged**; insufficient credits reject before the simulated provider call runs at all, balance unchanged.

`billing-exactly-once.integration.test.ts` (3 tests, real HTTP + real concurrency): two **truly concurrent** (`Promise.all`) HTTP requests with the same `idempotencyKey` — the real Postgres unique-constraint race genuinely fired (`ERROR: Unique constraint failed on the fields: (workspaceId,workflowDefinitionId,idempotencyKey)` observed in the real Prisma log), the engine's existing P2002/23505 recovery path returned the winner's instance to both callers, and exactly 3 `AIUsage` rows / 20 credits were charged for the one logical run (not 6/40); zero credits — the workflow starts (201) but the first AI step is rejected pre-flight, run ends `FAILED`, balance stays exactly 0, zero `ContentAsset` rows persisted; exact credit boundary (5 credits, exactly enough for the strategy step) — strategy succeeds and charges exactly 5, the pillars step (needs 5 more) is rejected pre-flight with zero credits left, balance lands at exactly 0 (never negative), and exactly 1 `AIUsage` row exists for the run (not 2).

**Commands**: `npx vitest run --config vitest.integration.config.ts src/modules/billing/credit-charge-ordering.integration.test.ts src/modules/billing/billing-exactly-once.integration.test.ts` → **6/6 passed**.

**Invariant proven**: one logical billable AI operation = at most one successful credit charge, under retry, under real concurrency, and at every credit boundary tested.

## 10. Credit Ledger Integrity

`computeBalance()` is the aggregate `sum(AICredit.amount) - sum(AIUsage.creditsConsumed)`, always recomputed from source rows (never trusting a denormalized snapshot alone). `recordUsage()`/`grantCredits()` both lock the owning `Workspace` row (`SELECT ... FOR UPDATE`) inside a transaction before reading/writing — verified this prevents lost updates under the real concurrent-request test in Section 9 (exactly 3 usage rows, not 6, from 2 racing requests). No code path allows a negative balance to be charged (pre-flight check + transactional re-check inside `recordUsage`). Direct SQL verification used throughout Section 9/11's tests (`prisma.aIUsage.findMany`/`count`, not just HTTP response bodies).

## 11. Idempotency & Concurrency

Covered in Section 9 (billing-specific) and Section 12 (tenant-specific, below) with genuine `Promise.all` concurrency, not sequential requests dressed up as concurrent. Result is deterministic: same `idempotencyKey` → exactly one instance, exactly one charge, regardless of which of the two concurrent requests "wins" the database race.

## 12. Provider Abstraction

Confirmed via the architecture audit (Section 4): `getAIProvider()` in `provider-router.ts` is the only place that knows both adapters exist; `OpenAIAdapter`'s constructor is the only place `OPENAI_API_KEY` is checked, and it is only ever constructed when `env.AI_PROVIDER === 'openai'` — the mock-only path never touches the OpenAI SDK's runtime. Model selection is configuration-driven (`env.OPENAI_MODEL`, one reference site) — not hard-coded per call site. Startup validation (missing `OPENAI_API_KEY` when `AI_PROVIDER=openai`) is enforced by the Zod `superRefine` in `env.ts`, re-verified live inside a real Docker container this phase (Section 20).

## 13. Error Classification

Taxonomy: `UpstreamProviderError` (transient, retried up to 3x) vs `ValidationError`/malformed-JSON `SyntaxError` (permanent, never retried) vs `InsufficientCreditsError` (pre-flight, provider never called). All are `AppError` subclasses mapped to RFC 7807 JSON by the single `error-handler.ts` — unhandled non-`AppError` values always become a generic 500 with no internal detail in the response body (server-side `console.error` only). Fixed this phase (Section 6): `OpenAIAdapter` no longer relays raw SDK error text into the client-facing message.

## 14. Timeout / Retry Design

No live-provider timeout/retry claim is made (correctly `BLOCKED — CREDENTIAL`). What is verified through real, testable boundaries: `MAX_STEP_ATTEMPTS = 3` with `2^attempt * 100ms` exponential backoff (`workflow-engine.service.ts`), `isTransientError()`'s classification logic (only `UpstreamProviderError`/`AbortError`/timeout-like message patterns are retried), and — critically — that retrying an AI operation **cannot** create a second credit charge, proven in Section 9. A gap noted honestly, not fixed (out of scope without a live key to validate against): the OpenAI SDK has its own default timeout/retry behavior, uncoordinated with the app's own retry budget — flagged in the architecture audit as a residual risk for whenever a real key is available.

## 15. Security

Fix in Section 6 closes a real error-message trust-boundary gap, proven by `openai.adapter.test.ts` — a **local unit test of this application's own error-handling code**, not of provider behavior: the OpenAI SDK's `chat.completions.create` is mocked (no network call to `api.openai.com` is made, ever) to throw an error containing an obviously-fake sensitive-looking string, and the test proves that string never reaches the client-facing `UpstreamProviderError`. Full secret scan re-run this phase: `env | grep -i openai` (shell), PowerShell `Get-ChildItem Env:` (both clean), `git log --all -p -- '*.env*'` (only the `.env.example` placeholder `replace-with-your-openai-api-key` found), source-tree regex scan for `sk-[A-Za-z0-9]{20,}` (zero matches), fresh Docker image filesystem scan and `docker image inspect --format .Config.Env` (zero secrets, zero `.env` files) — see Section 20. `request-logger.ts` confirmed (by reading, and by observing real log lines throughout this phase's test runs) to log only `requestId`/`method`/`route`/`status`/`durationMs`/`workspaceId`/`userId` — never request/response bodies.

**Command**: `npx vitest run src/infrastructure/openai/openai.adapter.test.ts` → **1/1 passed**.

## 16. Tenant Isolation

`ai-credit-tenant-isolation.integration.test.ts` — two real tenants running AI workflows **simultaneously** (`Promise.all`): each charged exactly its own 20 credits, unaffected by the other's concurrent run; direct SQL proves no `AIUsage` row for tenant A ever references tenant B's `workspaceId` or vice versa; tenant B's JWT cannot read tenant A's AI-generated workflow instance/content (404, anti-enumeration, not 403/leak) or approve it (404); reverse direction also tested; neither balance moved as a side effect of the cross-tenant probes.

**Command**: `npx vitest run --config vitest.integration.config.ts src/modules/billing/ai-credit-tenant-isolation.integration.test.ts` → **1/1 passed**.

## 17. Rate Limiting

`marketing-autopilot-rate-limit.integration.test.ts` — 21 real sequential HTTP requests against the configured `WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS=20`/hour guardrail: exactly 20 succeed (201), exactly the 21st is rejected (429) with the correct RFC 7807 body (`code: RATE_LIMIT_WORKFLOW_EXECUTION_EXCEEDED`), correct `RateLimit-Limit` header present, the response body contains no secrets/stack traces/internal paths (regex-checked), and exactly 20 `WorkflowInstance` rows exist afterward — proving the guardrail fires before any credit check or provider work for the rejected request. Not classified as a defect (per this phase's own instruction): this is the guardrail working as designed.

**Command**: `npx vitest run --config vitest.integration.config.ts src/modules/marketing-autopilot/marketing-autopilot-rate-limit.integration.test.ts` → **1/1 passed**.

## 18. Production Configuration

Unchanged from Phase 23's certified baseline, re-verified live this phase inside a fresh Docker container (Section 20): `AI_PROVIDER=openai` with no `OPENAI_API_KEY` fails fast at process startup (`Invalid environment configuration: OPENAI_API_KEY is required when AI_PROVIDER=openai`, exit 1) — no crash loop, no silent fallback to mock. `env.production-guard.test.ts` (19 tests, unchanged from Phase 23, re-run clean this phase) covers localhost CORS/DB-URL rejection, dev-placeholder-secret rejection, `USE_PGLITE_ADAPTER` rejection in production, and the malformed-`DATABASE_URL` cases added in Phase 23.

## 19. Docker AI-Path Regression

A fresh backend image (`bizpilot-backend:phase24`) was built from scratch this phase (not reused from Phase 23) via `MSYS_NO_PATHCONV=1 docker build -f backend/Dockerfile -t bizpilot-backend:phase24 .` — succeeded, ~5s on warm cache. Filesystem scan (`find /app -iname '*.env*' -o -iname '*.pem' -o -iname '*.key'`) and a regex secret scan inside the image (`grep -rl 'sk-[A-Za-z0-9]{20,}' /app`) both came back empty; `docker image inspect --format .Config.Env` shows only `PATH`/`NODE_VERSION`/`YARN_VERSION`/`NODE_ENV=production` — no secrets baked in.

A real container was started with `AI_PROVIDER=mock` against the real `bizpilot_ai_dev` database (`host.docker.internal`) — `Up ... (healthy)`, `/health/ready` → `200`. A full real HTTP session was driven through it: register → create workspace → create business profile → trigger the Marketing Autopilot workflow — reached `AWAITING_APPROVAL`. Direct SQL against the real database (`psql` in a throwaway container on the same network) confirmed exactly 3 `ai_usages` rows (5+5+10=20 credits), all `SUCCEEDED`, with `modelProvider='mock'`/`modelName='mock-v1'` populated — proving this phase's billing-order fix (Section 6) works correctly inside the actual production container, not just under `vitest`.

A second container was started with `AI_PROVIDER=openai` and no `OPENAI_API_KEY` — exited immediately (code 1) with the exact fail-fast error (`OPENAI_API_KEY is required when AI_PROVIDER=openai`), proving the production config guard works inside the real image, not just in unit tests.

Both containers and the temporary network were removed after verification; `bizpilot-backend:phase24` retained as a release artifact alongside the Phase 23 images.

**Commands and observed results**: recorded in full above; all real `docker build`/`docker run`/`curl`/`psql` executions, no simulated output.

## 20. Failure Recovery

Covered by: Section 9 (provider failure exhausting retries never partially charges), Section 8 (malformed output never crashes the process, fails clean), Section 17 (rate-limit rejection has zero side effects), Section 7 (rejected input has zero side effects), and Phase 23's already-certified restart/persistence/failure-injection/rollback gates (unaffected by this phase's changes — the credit-ledger and error-message changes do not touch container lifecycle, database connection handling, or Nginx routing).

## 21. Observability

`request-logger.ts` (unchanged, re-confirmed by reading and by direct observation of real log output throughout this phase's ~500+ real test-run HTTP requests): every line is one structured JSON object with `requestId`, `method`, `route`, `status`, `durationMs`, `workspaceId`/`userId` where authenticated — never body content. This phase's fix (Section 6) added a new server-side-only log line in `openai.adapter.ts` for provider failures (`promptKey`, `workspaceId`, sanitized `error.message` — never the API key, since the key is never part of the SDK's own error object). `recordUsage()` now also persists `modelProvider`/`modelName`/`latencyMs` on every `AIUsage` row (previously only `mock`/`mock-v1` were implicitly available via the return value but not stored) — confirmed via the direct SQL check in Section 20.

## 22. Performance

Real, reproducible local measurement (`ai-pipeline-performance.integration.test.ts`, 30 samples per micro-benchmark, 10 for the full HTTP path, against real Postgres) — explicitly isolated from any external provider latency, which remains unmeasured and unclaimed:

| Stage | p50 | p95 | min | max |
|---|---|---|---|---|
| Input validation (Zod, in-process, no I/O) | 0.01ms | 0.12ms | 0.00ms | 0.66ms |
| Credit pre-flight check (real DB read) | 1.13ms | 3.70ms | 0.85ms | 43.73ms |
| Billing write (real DB transaction, row lock) | 6.43ms | 10.13ms | 3.92ms | 10.15ms |
| Full HTTP AI-trigger (incl. MockProviderAdapter's synthetic 40-180ms × 3 sleep) | 444.56ms | 660.53ms | 387.82ms | 660.53ms |

The full-pipeline row includes the mock provider's deliberate synthetic delay (documented in its own source as simulated timing for UI/streaming-code testing) — this is a local, known, simulated component, not measured or invented external OpenAI latency. Real provider latency remains unmeasured pending a credential.

**Command**: `npx vitest run --config vitest.integration.config.ts src/modules/billing/ai-pipeline-performance.integration.test.ts` → **4/4 passed**.

## 23. Test Results (exact, freshly observed)

| Suite | Command | Result |
|---|---|---|
| Unit | `npx vitest run` | **60/60** (was 48; +11 output-validation schema tests, +1 error-redaction unit test) |
| Integration, real PostgreSQL | `npx vitest run --config vitest.integration.config.ts` | **76/76** (was 49 at Phase 23 close; +27 new Phase 24 tests across input validation/billing/tenant-isolation/rate-limiting/performance, 0 regressions) |
| Integration, PGlite | `USE_PGLITE_ADAPTER=true npx vitest run --config vitest.integration.config.ts` | **76/76** (parity with real Postgres, 0 regressions) |
| Playwright E2E | `npx playwright test` | **9/9** (unchanged from Phase 23, re-run to confirm the billing-order change didn't regress the UI golden path) |
| Backend lint | `npx eslint src --ext .ts` | **0 errors, 0 warnings** |
| Backend typecheck | `npx tsc --noEmit -p tsconfig.json` | **0 errors** |

No stale counts reported — every number above was observed in this session, this phase.

## 24. Live-Provider Status

```
REAL_AI_PROVIDER = BLOCKED — CREDENTIAL
```

Confirmed absent via: `env | grep -i openai` (shell, clean), PowerShell `Get-ChildItem Env: | Where-Object Name -match 'OPENAI|AI_PROVIDER|AI_MODEL'` (clean), `backend/.env`/`backend/.env.development` (both have `OPENAI_API_KEY=` empty), full git history scan (only the `.env.example` placeholder found, never a real key), and the Docker image inspections in Section 20. No key was invented, requested from the user beyond the already-declined offer in this phase's setup, or fabricated in any test. The following remain correctly unattempted and unclaimed: real OpenAI request, real model routing, real provider timeout, real provider retry, real provider rate-limit response, real provider authentication failure, real provider server failure, real provider usage accounting, full live AI production E2E.

## 25. Remaining Limitations

1. `REAL_AI_PROVIDER` and everything that requires it (Section 24) — a credential/business gap, not an engineering one.
2. The OpenAI SDK's own internal timeout/retry defaults are uncoordinated with this app's `MAX_STEP_ATTEMPTS`/backoff policy (Section 14) — cannot be tuned or verified without a live key.
3. No idempotency key is sent to OpenAI on the outbound request (Section 14 of the architecture audit) — if a real request ever succeeds on OpenAI's side but the response is lost before this app processes it, a retry would be a genuinely new (and separately billed, on OpenAI's side) completion. This app's own billing is still exactly-once per Section 9; this is a residual OpenAI-side double-request risk that can only be closed with real provider access to test against.

## 26. Evidence Matrix

| Gate | Status | Evidence | Test/Command | Notes |
|---|---|---|---|---|
| AI_ARCHITECTURE_AUDIT | VERIFIED | Section 4 | `docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md` | Written before any code change |
| INPUT_VALIDATION | VERIFIED | Section 7 | 14/14 real HTTP tests | Validation precedes credit/provider work |
| OUTPUT_VALIDATION | VERIFIED | Section 8 | 11/11 + 4/4 (1 new) | Malformed output never crashes, never retried |
| EXACTLY_ONCE_BILLING | VERIFIED | Section 9 | 6/6, incl. real DB race | Defect found + fixed this phase |
| CREDIT_LEDGER_INTEGRITY | VERIFIED | Section 10 | Direct SQL, row-lock proof | No negative balance, no lost update |
| IDEMPOTENCY_CONCURRENCY | VERIFIED | Sections 9, 11 | Real `Promise.all` races | Deterministic outcome |
| PROVIDER_ABSTRACTION | VERIFIED | Section 12 | Architecture audit + config guard | No provider leakage into domain logic |
| ERROR_CLASSIFICATION | VERIFIED | Sections 13, 15 | 1/1 redaction test | Fixed a real trust-boundary gap |
| TIMEOUT_RETRY_DESIGN | VERIFIED (non-live) | Section 14 | Code-level + billing-safety proof | Live provider timeout/retry correctly BLOCKED |
| SECURITY | VERIFIED | Section 15 | Full secret scan, log audit | Zero findings |
| TENANT_ISOLATION | VERIFIED | Section 16 | 1/1, real concurrent tenants | Both directions, direct SQL |
| RATE_LIMITING | VERIFIED | Section 17 | 1/1, 21 real requests | 20 through, 21st 429, correct body |
| PRODUCTION_CONFIGURATION | VERIFIED | Section 18 | 19/19 + live Docker re-check | Fail-fast confirmed inside real container |
| DOCKER_AI_PATH_REGRESSION | VERIFIED | Section 19 | Fresh image, 2 live containers | Full HTTP flow + fail-fast, both proven live |
| FAILURE_RECOVERY | VERIFIED | Section 20 | Cross-referenced | No new failure modes introduced |
| OBSERVABILITY | VERIFIED | Section 21 | Log audit, real output reviewed | New fields added (modelProvider/modelName) |
| PERFORMANCE | VERIFIED | Section 22 | Real p50/p95 measurement | External latency correctly unclaimed |
| REGRESSION_TESTING | VERIFIED | Section 23 | 60/60, 76/76 ×2, 9/9 | Zero regressions, exact counts |
| LIVE_PROVIDER_GATE | BLOCKED — CREDENTIAL | Section 24 | Multi-surface absence confirmation | No fabrication |

**19 of 19 non-provider-dependent gates VERIFIED. 1 gate BLOCKED — CREDENTIAL (expected, not fabricated). 0 FAILED.**

## 27. Final Verdict

```
RELEASE CANDIDATE — MINOR BLOCKERS
```

Every gate this phase could exercise without a live OpenAI credential is VERIFIED via real execution, including a genuine production-critical billing defect found and fixed with proof at both the integration-test and real-Docker-container level. The verdict is not upgraded to `PRODUCTION READY` for the same honest reason carried from Phase 23: `REAL_AI_PROVIDER` remains BLOCKED on a credential that does not exist in this environment.

## 28. Exact Next Action

Obtain a real `OPENAI_API_KEY` (add it to `backend/.env`, which is git-ignored) and run the live-provider certification this document could not: real request/response, real model routing, real timeout, real retry against actual transient failures, real malformed-response handling, real rate-limit response, real authentication-failure response, and a full AI-enabled production Docker + Playwright E2E run. That is the one remaining step to `PRODUCTION READY`.
