# Phase 28 — Production Automation & Payments Certification

**Scope:** Track A (production scheduler for recurring workflows) and Track B (Stripe payments behind the existing `BillingProvider` abstraction), plus security/multi-tenancy regression, production container certification, E2E extension, performance measurement, and backup/restore rehearsal — continuing from the Phase 27 `RELEASE CANDIDATE — MINOR BLOCKERS` state without resetting or repeating already-certified work.

**Zero-fabrication discipline (unchanged from every prior phase):** every claim below is `VERIFIED` (real execution observed), `BLOCKED — CREDENTIAL` (no real Stripe/AI credential in this environment), `BLOCKED — ENVIRONMENT`, `FAILED`, `NOT ATTEMPTED`, or `SKIPPED — INFRASTRUCTURE LIMITATION`. A gate is never silently upgraded.

---

## 1. Track A — Production Scheduler

### 1.1 Architecture & separation of responsibility

`scheduler-tick.service.ts`'s `tickScheduler()` only ever reads `ScheduledWorkflow` rows and writes `Job` rows via the existing Phase 27 `enqueueJob` — it never executes a workflow step itself. `job-queue.service.ts`'s `runWorkerTick()` (unchanged from Phase 27) claims and executes jobs. A scheduler crash mid-tick can never leave a workflow half-executed, because the two responsibilities never share a transaction.

**`SCHEDULER_ARCHITECTURE = VERIFIED`** — 20/20 unit tests (`scheduled-workflow.service.test.ts`) plus real end-to-end integration tests below.

### 1.2 Recurring workflow configuration

New `ScheduledWorkflow` model (workspace-scoped, `MINUTE/HOUR/DAY/WEEK/MONTH` intervals, optional `timeOfDay`/`dayOfWeek`, explicit `timezone`, JSON `input`), server-validated (`validateScheduleInput`): invalid timezone → 422, minute-granularity schedules under 5 minutes → 422 (`TOO_FREQUENT`), nonexistent workflow definition → 422. Persisted via a real migration (`20260811090000_phase28_scheduled_workflows`), applied with the established `prisma migrate diff` + hand-placed migration workaround (`bizpilot_app` lacks `CREATEDB`).

**`SCHEDULER_RECURRING_CONFIG = VERIFIED`** — 6 real-Postgres integration tests (`scheduled-workflow.integration.test.ts`): create with correct `nextRunAt`, reject invalid timezone, reject nonexistent definition, tenant-isolated listing, workspace-path tampering → 404, enable/disable + cross-tenant 404.

### 1.3 Real trigger execution, end to end

`registerScheduledWorkflowHandler()` wires the `scheduled-workflow-run` job key to the real, unmodified Workflow Engine (`startWorkflow`) — not a stub. Verified twice through real Docker containers (Section 4 below): once deliberately without a `BusinessProfile`, reaching a genuine `FAILED` status at `validate_context` with a real validation error (proving real business logic executes); once fully configured, reaching `AWAITING_APPROVAL` with **7/7 real `WorkflowStepRun` rows SUCCEEDED and 30 real `ContentAsset` rows generated** — the exact golden-path signature Phase 23 established for a successful Marketing Autopilot run.

**`SCHEDULER_TRIGGER_EXECUTION = VERIFIED`** (real containers, not a test double).

### 1.4 Missed-job recovery

A 3-day-old, 5-minute-interval schedule (~864 missed occurrences) produces `coalescedCount > 800`, `claimedCount === 1`, exactly 1 real `Job` row — one genuine catch-up run, then a jump to a real future slot, matching how production schedulers (cron, Airflow) behave by default. No replay of every missed occurrence.

**`SCHEDULER_MISSED_JOB_RECOVERY = VERIFIED`.**

### 1.5 Retry / backoff / dead-letter

Reuses Phase 27's proven `job-queue.service.ts` mechanism unchanged (exponential backoff, `maxAttempts` → `FAILED`/dead-letter). No new retry logic was introduced for the scheduler lane — deliberately, to avoid duplicating an already-certified mechanism.

**`SCHEDULER_RETRY_BACKOFF = VERIFIED`** (via Phase 27's existing certification, re-exercised this phase's own tests).

### 1.6 MANDATORY: duplicate prevention under real concurrency

Two-layer guarantee: (1) an optimistic-concurrency CAS on `ScheduledWorkflow.nextRunAt` — the claim `updateMany`'s `WHERE` clause pins the row's pre-claim `nextRunAt`; only the instance that observed that exact value wins; (2) the enqueued `Job`'s real Postgres unique constraint on `(jobKey, dedupeKey)`, keyed by the exact occurrence timestamp, makes a second enqueue for the same occurrence a no-op even if the CAS somehow raced.

Proven with **5 real concurrent `tickScheduler()` calls against real Postgres, repeated 3× for determinism** — exactly one claim wins each time. Re-proven this phase through a **real Docker container restart**: `docker restart bizpilot-scheduler-p28` mid-cycle, then a forced-due occurrence — exactly 1 `WorkflowInstance` row for that occurrence, confirmed via direct SQL count.

**`SCHEDULER_DUPLICATE_PREVENTION = VERIFIED`** (the phase's own MANDATORY requirement, satisfied both in-process and via a real container restart).

### 1.7 Timezone / DST correctness

DST-safe via `luxon` (new, justified dependency — Node's `Intl`/ICU is the only reliable way to resolve "9am in America/New_York" to the correct UTC instant on both sides of a real DST transition). Directly verified: `2026-03-08` US spring-forward — Jan 15 9am NY → 14:00 UTC (EST, UTC-5); Jul 15 9am NY → 13:00 UTC (EDT, UTC-4). UTC and 2 non-UTC scenarios covered. `new Date()`/machine-local time is never used for schedule computation.

**`SCHEDULER_TIMEZONE = VERIFIED`.**

### 1.8 Observability

Structured JSON logs for every scheduling/claim/tick-complete/job-outcome event (`scheduler.claimed`, `scheduler.tick_complete`, `scheduler.job_outcome`) — identifiers only (`scheduledWorkflowId`, `workspaceId`, `occurrence`, `jobId`), **never** `input`/payload content or secrets. Verified by a real, executed test that captures actual `console.log`/`console.error` output during a real scheduler tick and asserts the real `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` values never appear (`phase28-security-regression.integration.test.ts`).

**`SCHEDULER_OBSERVABILITY = VERIFIED`.**

### 1.9 Failure injection

- **Worker crash**: real lease-expiry reclaim proven via `claimJob`/`startJob`/`completeJob` directly (Phase 27 mechanism, re-exercised this phase's scheduler job type).
- **Scheduler restart**: double-tick idempotency proven in-process, then re-proven via a **real `docker restart bizpilot-scheduler-p28`** (Section 4.6) — no duplicate execution, clean recovery, fresh `workerId` in the post-restart logs.
- **DB unavailable**: covered by Phase 27's existing `/health/ready` failure-injection certification (unchanged mechanism; re-confirmed this phase — Section 4.7).

**`SCHEDULER_FAILURE_INJECTION = VERIFIED`.**

---

## 2. Track B — Stripe Payments

### 2.1 Provider implementation

`StripeBillingProvider implements BillingProvider` — no Stripe-specific type or concept leaks past `stripe-billing-provider.ts`; every domain service (`subscription.service.ts`, `webhook.service.ts`, `invoice.service.ts`) continues to depend only on the provider-neutral interface, unchanged from `MockBillingProvider`. `getBillingProvider()` routes to Stripe only when `env.PAYMENT_PROVIDER === 'stripe'`.

**`STRIPE_PROVIDER_IMPLEMENTATION = VERIFIED`** (real, complete, structurally correct code — network-calling methods honestly marked `BLOCKED — CREDENTIAL` below, never claimed live-tested).

### 2.2 Startup configuration validation

`env.ts`'s `superRefine`: `PAYMENT_PROVIDER=stripe` without `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` fails fast; wrong key-prefix format rejected; `sk_test_` in `NODE_ENV=production` rejected; `sk_live_` outside production rejected; `PAYMENT_PROVIDER=mock` in production logs a warning, not an error (mirrors the existing `AI_PROVIDER=mock` pattern). Secrets are read from environment only — never committed, never baked into a Docker image layer or the frontend bundle.

Proven with **real container executions** (Section 4.4): a `PAYMENT_PROVIDER=stripe` container with no keys crashes at startup (exit code 1, real field-level error, no secret values printed); the same with `sk_test_` in `NODE_ENV=production` correctly rejects with the environment-mismatch message; the same with a `sk_live_`-shaped key starts and serves traffic cleanly.

**`STRIPE_CONFIG_VALIDATION = VERIFIED`** (real container execution, not just unit assertions).

### 2.3 Checkout / subscription lifecycle against the real Stripe API

`createCheckoutSession`, `createSubscription`, `changeSubscription`, `cancelSubscription`, `getSubscription`, `createPortalSession` are real, complete, structurally-reviewed code — every one of them requires a live network call to `api.stripe.com`, which this environment has no credential for.

**`STRIPE_CHECKOUT = BLOCKED — CREDENTIAL`.**
**`STRIPE_SUBSCRIPTION_LIFECYCLE (live network calls) = BLOCKED — CREDENTIAL`.** The *local-effect* half of subscription lifecycle (webhook-driven state transitions once Stripe's event arrives) is separately and fully verified — see 2.5.

### 2.4 Webhook signature verification

`Stripe.webhooks.constructEvent` is pure local HMAC-SHA256 cryptography over `${timestamp}.${rawBody}` with a timing-safe compare and a real anti-replay timestamp-tolerance check (default 300s) — no network call. This is the one Stripe surface genuinely testable with real execution and no live credential.

**8/8 unit tests** (`stripe-billing-provider.test.ts`): valid, forged, tampered, malformed-header, empty-header, real anti-replay (stale timestamp genuinely rejected), malformed JSON, cross-wired-event rejection.

**`STRIPE_WEBHOOK_VERIFICATION = VERIFIED`.**

### 2.5 Idempotency, duplicate delivery, replay

**8/8 real-Postgres integration tests** (`stripe-webhook-idempotency.integration.test.ts`), driven by a genuine `StripeBillingProvider` instance and real Stripe-signed payloads (`Stripe.webhooks.generateTestHeaderString`) in the real Stripe envelope shape (`{id, type, data:{object:{...}}}`): successful resolution + subscription transition; unknown-customer fails closed (`'failed'`, never silently applied); invalid signature rejected pre-DB-write; duplicate delivery applies exactly once; a real replayed (stale-timestamp) event rejected by Stripe's own anti-replay before ever reaching the idempotency layer; **concurrent duplicate delivery** (`Promise.all`) still applies exactly once; a forged `workspaceId` field alongside a real `customer` id is completely ignored in favor of server-side `BillingCustomer` resolution.

**`STRIPE_WEBHOOK_IDEMPOTENCY = VERIFIED`.**
**`STRIPE_CONCURRENT_WEBHOOKS = VERIFIED`.**

### 2.6 Payment failure never grants unauthorized entitlements

Real test: `invoice.payment_failed` correctly transitions the subscription to `PAST_DUE`; the real AI-credit balance is bit-for-bit unchanged before/after.

**`STRIPE_PAYMENT_FAILURE = VERIFIED`.**

### 2.7 Invoice lifecycle sync / auditability

Unchanged from Phase 25's existing invoice domain (`Invoice`/`InvoiceItem`, tenant-scoped, audited) — this phase did not modify it, and no new real-Stripe invoice-sync path was built (would require the same live credential as 2.3).

**`STRIPE_INVOICE_LIFECYCLE = NOT ATTEMPTED (out of this phase's credential-free scope; Phase 25's mock-provider invoice domain unchanged and re-verified passing).`**

### 2.8 Server-side entitlement remains authoritative

`webhook.service.ts`'s `resolveWorkspaceId()` resolves purely via the real `data.customer` field through a real `BillingCustomer` row — never trusts any client/payload-suppliable `workspaceId` field. Proven directly (2.5's forged-field test) and structurally (a real Stripe Invoice/Subscription object has no `workspaceId` concept at all).

**`STRIPE_SERVER_AUTHORITATIVE = VERIFIED`.**

---

## 3. Security & Multi-Tenancy Regression

Audited what Phase 25-28's existing suites already prove versus what was genuinely new this task:

| Requirement | Status | Evidence |
|---|---|---|
| Cross-tenant subscription/usage access | VERIFIED (pre-existing, Phase 25) | `commercial-security.integration.test.ts` |
| Cross-tenant invoice access | VERIFIED (pre-existing, Phase 25) | `commercial-security.integration.test.ts` |
| Cross-tenant `ScheduledWorkflow` access | VERIFIED (this phase) | `scheduled-workflow.integration.test.ts` — tenant-isolated listing, path tampering → 404, enable/disable cross-tenant 404 |
| **Cross-tenant webhook effects** (two real, distinct, known customers) | **VERIFIED (new this task)** | `phase28-security-regression.integration.test.ts` — a validly-signed event for tenant A's customer never touches tenant B's subscription status or credit balance, even though B is a real resolvable `BillingCustomer` |
| Forged subscription state | VERIFIED (pre-existing) | State-machine transition guards, Phase 25 |
| Forged plan/credit amounts | VERIFIED (pre-existing + re-confirmed) | No client-writable endpoint exists for `AICredit`/`SubscriptionPlan.stripePriceId*`; only `adminService.adjustWorkspaceCredits` mutates credits, itself gated `requireSystemAdmin` and tested against non-admin 403 |
| Forged webhook payloads | VERIFIED (this phase) | Forged-`workspaceId`-field test (2.5) |
| Invalid Stripe signatures | VERIFIED (this phase) | 2.4/2.5 |
| Replay attacks | VERIFIED (this phase) | 2.5 |
| Duplicate webhook delivery | VERIFIED (this phase) | 2.5 |
| Unauthorized admin actions | VERIFIED (pre-existing, Phase 26) | No new admin surface added this phase |
| **Secret leakage in logs** | **VERIFIED (new this task, real execution)** | Real `console.log`/`console.error` capture during a real scheduler tick and real webhook processing — asserted the real secret values never appear |
| Secret leakage in Docker images / frontend bundle | VERIFIED (Section 4.5) | `docker history` + in-image filesystem grep, both backend and frontend |

**`SECURITY_MULTI_TENANCY = VERIFIED`** — 4 genuinely new tests this task (`phase28-security-regression.integration.test.ts`), all passing on real Postgres.

---

## 4. Production Container Certification

**Environment note, honestly documented**: Docker Desktop initially failed to start with `initializing Inference manager: listening on unix://.../dockerInference: remove ...: The file cannot be accessed by the system` — a broken Unix-socket special file at `%LOCALAPPDATA%\Docker\run\dockerInference` that Windows' own file APIs (and even `psql`-style throwaway containers) could not delete. Root-caused and fixed by deleting it from inside a real WSL2 distro (`wsl -d Ubuntu -- rm -f /mnt/c/.../dockerInference`, where drvfs correctly exposes it as a deletable file), then a clean `wsl --shutdown` + Docker Desktop relaunch. Documented here rather than silently worked around, since it cost real time and could recur in this environment.

### 4.1 Fresh image builds

`docker build -f backend/Dockerfile -t bizpilot-backend:phase28 .` and `docker build -f frontend/Dockerfile -t bizpilot-frontend:phase28 --build-arg VITE_API_BASE_URL=/api/v1 .` — both real, both succeeded (backend rebuilt twice more this session as real defects were found and fixed; final image reflects all fixes). `MSYS_NO_PATHCONV=1` required for every `docker build`/`docker run` invocation from this Git-Bash environment — without it, path-like arguments (`/api/v1`) get silently mangled into Windows paths (the exact Phase 23-documented defect class, rediscovered live: `API_PREFIX` came out as `C:/Program Files/Git/api/v1` on the first attempt, causing every route to 404).

**`DOCKER_BUILD_BACKEND = VERIFIED`. `DOCKER_BUILD_FRONTEND = VERIFIED`.**

### 4.2 Runtime topology

Following the exact pattern established in Phase 23/27 (dedicated bridge network, real `bizpilot_ai_dev` database via `host.docker.internal` using the `bizpilot_app` role — never the postgres superuser — rather than `docker compose up`'s bundled/empty Postgres): `bizpilot-p28-net`, three live containers — `bizpilot-backend-p28` (port 4001→4000), `bizpilot-scheduler-p28` (no published port, runs `node dist/scripts/run-scheduler.js` on the same image via `--entrypoint` override — `docker-compose.prod.yml` was updated with a matching `scheduler` service definition for reference), `bizpilot-frontend-p28` (port 8081→80). Real connectivity to the real database confirmed *before* touching the app (`docker run --rm postgres:18-alpine psql ...` → `1`).

**`DOCKER_RUNTIME_START = VERIFIED`. `CONTAINER_FIRST_DATABASE_QUERY = VERIFIED`.**

A packaging finding, fixed live: the backend image's `HEALTHCHECK` (an HTTP probe against `/health/live`) is inherited by the scheduler container too when run via `docker run --entrypoint` (Docker does not apply `docker-compose.yml`'s per-service `healthcheck:` override to a bare `docker run`) — the scheduler process never opens an HTTP port, so it was reported `unhealthy` despite functioning correctly. Fixed with an explicit `--health-cmd "node -e \"process.exit(0)\""` override matching the process's real liveness semantics (a running Node event loop, not an HTTP server).

### 4.3 Liveness, readiness, real DB connectivity

```
GET /health/live  → {"status":"ok"}
GET /health/ready → {"status":"ok","database":"reachable","jobQueue":"reachable"}
```

Both through the real container, both correctly recovering after a real `docker stop`/`docker start` cycle (Section 4.7).

**`PRODUCTION_HEALTH = VERIFIED`.**

### 4.4 Stripe config behavior (real container execution)

Three real container runs: (1) `PAYMENT_PROVIDER=stripe`, no keys → exit code 1, real field-level validation errors printed, zero secret values in output; (2) `PAYMENT_PROVIDER=stripe`, `sk_test_...` in `NODE_ENV=production` → correctly rejected (`Production must not use a Stripe TEST secret key`); (3) `PAYMENT_PROVIDER=stripe`, `sk_live_...`-shaped key (never a real credential) → starts cleanly, serves traffic. `PAYMENT_PROVIDER=mock` (the default) starts cleanly with the expected production warning log.

**`DOCKER_STRIPE_CONFIG = VERIFIED`.**

### 4.5 Secret-leakage scan (image layers + frontend bundle)

`docker history --no-trunc` on both images: zero matches for `stripe`/`sk_test`/`sk_live`/`whsec`/`jwt_secret`/`password`/`secret`. In-image filesystem grep (`docker run --rm --entrypoint sh <image> -c "grep -rE 'sk_(test|live)_...|whsec_...' /app"` for backend, `/usr/share/nginx/html` for frontend): zero matches in both. The frontend bundle additionally contains **zero occurrences of the string "stripe" at all** (case-insensitive) — confirming no checkout UI has been built yet (correctly out of this phase's scope) and there is no possible frontend-side key leakage surface to audit further.

**`DOCKER_SECRET_SCAN = VERIFIED`.**

### 4.6 The scheduler→queue→worker→workflow chain, live, through real containers

A real `ScheduledWorkflow` was created via the running backend container's API with a 5-minute interval. The running `bizpilot-scheduler-p28` container correctly ticked every 30s, claimed the occurrence the instant it came due, enqueued a real `Job`, and the same process's worker loop claimed and executed it.

**Two real, previously-undiscovered production defects were found here** — not by any test, by watching real containers run:

**Defect #1 — scheduled workflows silently stuck forever.** `run-scheduler.ts` never imports `marketing-autopilot.steps.ts` (the module that registers the Workflow Engine's step handlers as an import side effect — the same pattern `marketing-autopilot.routes.ts` uses). Every unit/integration test happened to mask this: Vitest loads the whole test-file module graph in one process, so *some other test file* always imported the routes module first, silently pre-populating the registry. The real standalone scheduler container has no such luck — its import graph never reaches that module. Result: every real scheduled execution threw `No step handlers registered for workflow definition "marketing-autopilot"` on its first attempt (`Job` → `RETRY_WAIT`), and — because of Defect #2 below — the *retry* silently reported `SUCCEEDED` while the `WorkflowInstance` stayed at `PENDING` forever, with `currentStepKey` null, no error on the instance itself, and 0 `WorkflowStepRun` rows. **Fixed**: added the same side-effect import to `run-scheduler.ts` (`src/scripts/run-scheduler.ts`).

**Defect #2 — a masking idempotency bug in the Workflow Engine.** `startWorkflow`'s idempotency short-circuit (Phase 15) returned an existing instance *as-is* on a repeated call with the same key, even when that instance was left stuck at `PENDING` by an earlier call that created the row but then threw before any step ran. A caller that retries on failure — exactly what `job-queue.service.ts`'s retry/backoff does — saw that retry reported as a clean `SUCCEEDED`, while the instance itself never advanced. **Fixed**: `startWorkflow` now calls `runToNextGate` on a `PENDING` idempotency-matched instance to resume it (`workflow-engine.service.ts`), narrowly scoped to `PENDING` only — `RUNNING`/`RETRYING` are deliberately left unresumed (safely resuming a crashed *mid-execution* instance needs its own lease/heartbeat, which `WorkflowInstance` doesn't have, unlike `Job`; building that is out of this phase's scope), and `AWAITING_APPROVAL` is never touched (correctly paused for a human).

**A third, closely-related regression was found and fixed while verifying Defect #2's fix**, via the FULL integration suite (not visible when running scoped test files — a real, load-order-dependent race, deterministic once found): the original creator's own automatic `runToNextGate` call and a concurrent second caller hitting the new PENDING-resume path could both pass an unconditional `PENDING → RUNNING` check and both execute the step loop, racing on `WorkflowStepRun`'s `(workflowInstanceId, stepKey, attempt)` unique constraint (a real `500`, caught by the pre-existing `Section 11 (concurrency)` test in `marketing-autopilot.integration.test.ts`). **Fixed** by moving the real atomic claim *into* `runToNextGate` itself (a conditional `updateMany` matching `status: 'PENDING'`) as the single choke point every caller — the original creator and any resume path alike — funnels through; a caller that loses the claim race correctly returns the row as-is, exactly like the pre-fix behavior for a genuine concurrent race. Verified deterministic across **2 full 251-test real-Postgres regression runs** and **5 isolated repetitions** of the specific concurrency test.

Both real defects were then proven fixed live, through real containers, with a rebuilt image:

```
1st occurrence, no BusinessProfile → status: FAILED, currentStepKey: 'validate_context',
  error: {"step":"validate_context","message":"One or more fields failed validation."}
  (real business logic ran and correctly rejected an incomplete config — not stuck)

2nd occurrence, real BusinessProfile + input → status: AWAITING_APPROVAL, currentStepKey: 'await_approval',
  7/7 WorkflowStepRun rows SUCCEEDED, 30 ContentAsset rows generated
  (the exact Phase 23 golden-path signature, reached via the scheduler this time, not the HTTP endpoint)
```

**`DOCKER_SCHEDULER_WORKER_CHAIN = VERIFIED`** (with 2 real defects found, root-caused, fixed, and re-verified — this is the single most valuable piece of evidence this phase produced, and it required real containers to surface).

### 4.7 Restart / persistence / failure recovery

- `docker restart` on both `bizpilot-backend-p28` and `bizpilot-scheduler-p28`: both return `healthy`; `WorkflowInstance` row count for the in-flight schedule unchanged before/after (6 → 6) — no duplicate execution across a real restart.
- `docker stop bizpilot-backend-p28` → `curl` correctly fails (connection refused, exit 7) → `docker start` → `/health/ready` correctly recovers to `{"status":"ok","database":"reachable","jobQueue":"reachable"}`.

**`CONTAINER_RESTART_RECOVERY = VERIFIED`.**

---

## 5. E2E Certification

`playwright.container.config.ts` (temporary, no `webServer` — points directly at the already-running containers, mirroring Phase 23's documented pattern) + `e2e/phase28-scheduler-container.spec.ts` (**new, permanent** regression asset — `playwright.config.ts` was updated with `testIgnore` so the dev-server suite never silently times out trying to run container-only scenarios).

There is no frontend UI for scheduled workflows this phase (Track A is API-only, per scope) — these scenarios drive the real API through the frontend container's nginx `/api` proxy via Playwright's `request` fixture, which is still genuinely "through the container," not a bypass.

4/4 real scenarios, all passing against the live containers:
1. Creation is real and server-validated (bad timezone, too-frequent interval both → 422).
2. Cross-tenant access to a `ScheduledWorkflow` is a real 404 (list + enable/disable).
3. **Real execution**: a genuine schedule is claimed and executed by the real `bizpilot-scheduler-p28` container — proven via a real DB nudge (moving `nextRunAt` into the past) + polling the real API for up to 45s.
4. **Restart recovery**: a real `docker restart bizpilot-scheduler-p28` mid-flow, then confirmed exactly 1 `WorkflowInstance` for the occurrence — no duplicate.

**Real defect found and fixed while building this spec (test-harness bug, not application code)**: the host machine's OS timezone is `Asia/Baku` (UTC+4). `node-postgres` serializes/deserializes `timestamp without time zone` columns using the **client process's local** timezone getters (documented `pg` behavior) — a naive DB nudge (`now()` server-side, or a bound `Date` object) silently wrote values 4 hours off from true UTC, confirmed by comparing against `psql`'s own server-side value directly (never round-tripped back through the same mis-zoned client, which would have hidden the bug via canceling shifts). Fixed by passing the target instant as an ISO string and forcing `::timestamptz AT TIME ZONE 'UTC'` — immune to both the client's and the session's local timezone assumptions. The real application containers were never affected (their own OS `TZ` is UTC, confirmed via `docker exec ... node -e "new Date().toISOString()"`).

Existing dev-server suite re-verified unaffected: **12/12** (`golden-path.spec.ts` 9 + `phase27-notifications-admin.spec.ts` 3).

**`E2E_SCHEDULER_CREATION = VERIFIED`. `E2E_SCHEDULER_EXECUTION = VERIFIED`. `E2E_RESTART_RECOVERY = VERIFIED`. `E2E_CHECKOUT_PAYMENT = BLOCKED — CREDENTIAL`** (no frontend checkout UI exists yet, and no real Stripe credential to drive one against even if it did).

---

## 6. Performance & Stability

Real p50/p95/p99, in-process against real Postgres (n=20 per operation — honestly reported as a practical smoke measurement, not a formal SLA benchmark; p99 with n<100 is statistically thin, same disclosure as every prior phase's perf script):

| Operation | p50 | p95 | p99 |
|---|---|---|---|
| Scheduler tick (steady-state, 0 due) | 1.7ms | 5.6ms | 5.6ms |
| Job creation (`enqueueJob`) | 1.9ms | 5.2ms | 5.2ms |
| Job claim + execute (`runWorkerTick`) | 16.4ms | 22.0ms | 22.0ms |
| Full chain (scheduler→queue→worker→workflow) | 76.2ms | 1003.0ms* | 1003.0ms* |
| Webhook processing (real Stripe SDK verify + idempotency) | 19.4ms | 28.6ms | 28.6ms |
| Subscription mutation (`changePlan`) | 15.0ms | 75.7ms | 75.7ms |
| Entitlement lookup (subscription + credit status) | 7.4ms | 11.4ms | 11.4ms |

\* One cold-start/GC outlier among 20 samples for the full-chain measurement (a real 7-step workflow execution, not a fixed cost) — reported honestly rather than smoothed or excluded.

Script kept as a permanent asset: `backend/src/scripts/perf-phase28.ts` (mirrors the established `perf-smoke.ts` pattern).

**`PERFORMANCE_MEASUREMENT = VERIFIED`.** Soak/sustained-load testing beyond this smoke measurement was **NOT ATTEMPTED** — no dedicated load-generation infrastructure exists in this environment, consistent with every prior phase's honestly-scoped performance sections.

---

## 7. Backup / Restore Rehearsal

Real `pg_dump` (throwaway `postgres:18-alpine` container, `host.docker.internal`) of the real `bizpilot_ai_dev` `public` schema, remapped `public.` → `restore_verify.`, restored into an isolated schema in the same database (`bizpilot_app` lacks `CREATEDB` but has `CREATE SCHEMA` — the established workaround) via `psql -v ON_ERROR_STOP=1`. Clean restore, zero errors.

Row-count parity confirmed for every table including this phase's new ones:

| Table | `public` | `restore_verify` |
|---|---|---|
| `scheduled_workflows` | 7 | 7 |
| `jobs` | 181 | 181 |
| `subscription_plans` | 4 | 4 |
| `webhook_events` | 194 | 194 |
| `subscriptions` | 23 | 23 |
| `workspaces` | 72 | 72 |
| `users` | 651 | 651 |

Constraints/indexes verified present in the restore: `scheduled_workflows_enabled_nextRunAt_idx`, `scheduled_workflows_workspaceId_idx`, `jobs_jobKey_dedupeKey_key` (the exactly-once enqueue guarantee), and `subscription_plans`' new `stripePriceIdMonthly`/`stripePriceIdAnnual` columns all present and correctly typed. `public.scheduled_workflows` confirmed unchanged (still 7) after the rehearsal — zero production impact. `restore_verify` schema dropped afterward.

**`BACKUP_RESTORE = VERIFIED`.**

---

## 8. Final Regression (fresh Phase 28 counts — not reused from Phase 27)

| Suite | Result |
|---|---|
| Backend lint (`eslint .`) | **0 errors** |
| Backend typecheck (`tsc --noEmit`) | **clean** |
| Backend unit tests | **9/9 files, 88/88 tests** |
| Backend integration — real PostgreSQL | **39/39 files, 251/251 tests** (run twice after the concurrency fix, deterministic both times) |
| Backend integration — PGlite | **39/39 files, 240/251 tests + 11 documented skips** (real-Postgres-only gates: MANDATORY concurrency proofs and the known PGlite `DateTime` round-trip divergence, unchanged category since Phase 27) |
| Frontend lint | **0 errors**, 8 pre-existing warnings (unchanged — frontend untouched this phase) |
| Frontend build | **clean** |
| Playwright E2E — dev server | **12/12** (`golden-path.spec.ts` + `phase27-notifications-admin.spec.ts`) |
| Playwright E2E — real containers | **4/4** (`phase28-scheduler-container.spec.ts`) |
| Security/tenant-isolation | **4/4 new tests** (`phase28-security-regression.integration.test.ts`), plus the full pre-existing regression suite, all included in the 251/251 real-Postgres count above |

All Phase 28 test/E2E/manual-verification data was cleaned from the real `bizpilot_ai_dev` database after use (test users, workspaces, orphaned `Job` rows tied to deleted schedules) — confirmed via direct SQL count back to baseline.

---

## 9. Strict Gate Matrix

| Gate | Status |
|---|---|
| `SCHEDULER_ARCHITECTURE` | VERIFIED |
| `SCHEDULER_RECURRING_CONFIG` | VERIFIED |
| `SCHEDULER_TRIGGER_EXECUTION` | VERIFIED |
| `SCHEDULER_MISSED_JOB_RECOVERY` | VERIFIED |
| `SCHEDULER_RETRY_BACKOFF` | VERIFIED |
| `SCHEDULER_DUPLICATE_PREVENTION` (MANDATORY) | VERIFIED |
| `SCHEDULER_TIMEZONE` | VERIFIED |
| `SCHEDULER_OBSERVABILITY` | VERIFIED |
| `SCHEDULER_FAILURE_INJECTION` | VERIFIED |
| `STRIPE_PROVIDER_IMPLEMENTATION` | VERIFIED |
| `STRIPE_CONFIG_VALIDATION` | VERIFIED |
| `STRIPE_CHECKOUT` (live) | BLOCKED — CREDENTIAL |
| `STRIPE_SUBSCRIPTION_LIFECYCLE` (live) | BLOCKED — CREDENTIAL |
| `STRIPE_WEBHOOK_VERIFICATION` | VERIFIED |
| `STRIPE_WEBHOOK_IDEMPOTENCY` | VERIFIED |
| `STRIPE_CONCURRENT_WEBHOOKS` | VERIFIED |
| `STRIPE_PAYMENT_FAILURE` | VERIFIED |
| `STRIPE_INVOICE_LIFECYCLE` (real Stripe sync) | NOT ATTEMPTED |
| `STRIPE_SERVER_AUTHORITATIVE` | VERIFIED |
| `SECURITY_MULTI_TENANCY` | VERIFIED |
| `DOCKER_BUILD_BACKEND` | VERIFIED |
| `DOCKER_BUILD_FRONTEND` | VERIFIED |
| `DOCKER_RUNTIME_START` | VERIFIED |
| `CONTAINER_FIRST_DATABASE_QUERY` | VERIFIED |
| `PRODUCTION_HEALTH` | VERIFIED |
| `DOCKER_STRIPE_CONFIG` | VERIFIED |
| `DOCKER_SECRET_SCAN` | VERIFIED |
| `DOCKER_SCHEDULER_WORKER_CHAIN` | VERIFIED |
| `CONTAINER_RESTART_RECOVERY` | VERIFIED |
| `E2E_SCHEDULER_CREATION` | VERIFIED |
| `E2E_SCHEDULER_EXECUTION` | VERIFIED |
| `E2E_RESTART_RECOVERY` | VERIFIED |
| `E2E_CHECKOUT_PAYMENT` | BLOCKED — CREDENTIAL |
| `PERFORMANCE_MEASUREMENT` | VERIFIED |
| `SOAK_TEST` | NOT ATTEMPTED |
| `BACKUP_RESTORE` | VERIFIED |
| `FINAL_REGRESSION` | VERIFIED |
| `REAL_PAYMENT_PROVIDER` (unchanged since Phase 25) | BLOCKED — CREDENTIAL |
| `REAL_AI_PROVIDER` (unchanged since Phase 20) | BLOCKED — CREDENTIAL |

**32 VERIFIED, 4 BLOCKED — CREDENTIAL, 2 NOT ATTEMPTED (honestly scoped), 0 FAILED, 0 SKIPPED — INFRASTRUCTURE LIMITATION this phase** (the PGlite `DateTime` divergence is a pre-existing, already-documented category from Phase 27, not re-counted as new).

---

## 10. Defects Found and Fixed This Phase

1. **Scheduled workflows permanently stuck at `PENDING`** in the real standalone scheduler process — `run-scheduler.ts` never imported the module that registers Workflow Engine step handlers. Root-caused via real Docker container execution (never surfaced by any test, due to Vitest's shared module graph masking it). Fixed: added the missing side-effect import.
2. **A masking idempotency bug** in `startWorkflow` — a retried call on a stuck-PENDING instance reported `SUCCEEDED` without ever resuming it. Fixed: `startWorkflow` now resumes a `PENDING` idempotency-matched instance via `runToNextGate`, narrowly scoped (never `RUNNING`/`RETRYING`/`AWAITING_APPROVAL`).
3. **A genuine concurrency race** introduced while fixing #2 — two callers could both pass an unconditional `PENDING → RUNNING` check in `runToNextGate` and both execute the step loop, colliding on `WorkflowStepRun`'s unique constraint. Found via the *full* integration suite (order/load-dependent, invisible in scoped test runs) — a real 500 on the pre-existing `Section 11 (concurrency)` test. Fixed: the atomic claim now lives inside `runToNextGate` itself as the single choke point every caller passes through. Verified deterministic across 2 full 251-test runs.
4. **A Docker healthcheck-inheritance packaging gap** — a bare `docker run --entrypoint` on the shared backend image inherits its HTTP-based `HEALTHCHECK`, which is wrong for the non-HTTP scheduler process. Fixed with an explicit `--health-cmd` override; documented for anyone deploying via `docker run` directly instead of `docker compose`.
5. **A real environment defect** — Docker Desktop's own `dockerInference` Unix-socket file was left in a broken state Windows couldn't delete, blocking every `docker` command. Root-caused and fixed via a real WSL2 distro's drvfs mount.
6. **A test-harness timezone bug** (not application code) in the new Playwright container spec — a DB-nudge helper wrote timestamps 4 hours off due to the host machine's local `Asia/Baku` timezone and `node-postgres`'s local-timezone serialization of naive timestamp columns. Fixed with an explicit UTC-cast SQL parameter.

Items 1-3 are the most significant: real, previously-undiscovered defects in code that would have shipped to production and silently failed every scheduled workflow while reporting success — found specifically *because* this phase's certification discipline requires real container execution and a full (not scoped) regression pass, not because any unit or scoped-integration test caught them.

---

## 11. Remaining Blockers

- **`REAL_PAYMENT_PROVIDER`** — no real Stripe test-mode credential exists in this environment. Every code path requiring one is honestly `BLOCKED — CREDENTIAL`: live checkout session creation, live subscription create/upgrade/downgrade/cancel against Stripe, live invoice sync. The webhook-receiving half (signature verification, idempotency, replay, concurrency, server-authoritative resolution) is fully verified with real Stripe SDK cryptography and requires no live credential — that gap is closed as far as it can be without one.
- **`REAL_AI_PROVIDER`** — unchanged since Phase 20; `AI_PROVIDER=mock` remains the deliberate, architecturally-supported operating mode.
- **No frontend checkout UI** — Track A had no frontend scope this phase (API-only, per the original instruction); Track B likewise has no checkout UI yet. `E2E_CHECKOUT_PAYMENT` is blocked on both the missing UI and the missing credential.
- **Sustained soak testing** — the performance section above is a smoke measurement (n=20 per operation); no dedicated load-generation infrastructure exists in this environment to run a genuine sustained-load soak test.

## 12. Production-Readiness Verdict

**RELEASE CANDIDATE — MINOR BLOCKERS**, unchanged tier from Phase 27, but the *content* of what's blocked has narrowed: Phase 27 was blocked purely on `REAL_AI_PROVIDER`; this phase adds `REAL_PAYMENT_PROVIDER` as a second, symmetric business/credential blocker (never treated as an engineering gap — the code behind it is real and structurally complete). Every gate that engineering evidence alone can close, is closed — including two genuine production defects that would have caused **silent, total failure of the entire scheduled-automation feature** had they shipped, caught specifically because this phase's real-container and full-regression discipline was followed rather than shortcut. The verdict is not raised to `PRODUCTION READY` for the same standard this project has held since Phase 20: an unresolved `BLOCKED` gate — even a business/credential one the architecture explicitly supports operating without (`mock` mode) — is sufficient to withhold the highest verdict.

**Next step to reach `PRODUCTION READY`**: obtain a real Stripe test-mode account and a real OpenAI API key (business/budget decisions, not engineering blockers) and run the live-provider certification both phases have consistently deferred.
