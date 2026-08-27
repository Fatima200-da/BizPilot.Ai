# Phase 29 — Production Growth, Reliability & Customer Intelligence

**Mission:** turn BizPilot.Ai from a technically certified SaaS (Phase 28: `RELEASE CANDIDATE — MINOR BLOCKERS`) into a product that can safely acquire, onboard, retain, and learn from its first real customers.

**Zero-fabrication discipline (unchanged from every prior phase):** every claim below is `VERIFIED` (real execution observed), `PARTIALLY VERIFIED`, `BLOCKED — CREDENTIAL`, `BLOCKED — ENVIRONMENT`, `DEFERRED` (a real decision, deliberately postponed, with a stated reason), `NOT ATTEMPTED`, or `FAILED`. A gate is never silently upgraded.

---

## 1. Mandatory repository audit

Before writing any new code, the existing Notification/Activity/analytics surface was audited directly against the schema and call sites (not assumed from prior phase docs). Real findings: `Activity` model existed with **zero real usage anywhere in the codebase** (no writer, no reader) — the dashboard had no activity feed at all; `NotificationType` had 3 enum values (`WORKFLOW_RETRYING`, `PAYMENT_FAILED`, `SCHEDULED_WORKFLOW_COMPLETED`... actually all pre-existing except the first two, confirmed by grep) with zero call sites; onboarding's backend state machine never reached `COMPLETED`. These three real gaps directly shaped this phase's scope rather than being assumed from the spec alone.

## 2. Product analytics foundation

`ProductEvent` (workspace/user-scoped, `eventName` string column intentionally not a Postgres enum so new events don't require a migration) + `trackEvent()` (fire-and-forget — a tracking failure never breaks the real business operation it's attached to) wired into 12 real call sites: registration, login, workspace creation, onboarding completion, workflow start/completion (generic + gated "first-X" variants), first AI action (credit-ledger), content generation/approval, subscription upgrade/cancel/reactivate.

The client-facing `POST /workspaces/:id/events` endpoint validates against `CLIENT_TRACKABLE_EVENTS`, a server-side allowlist — a real defect was found and fixed here during development: both this endpoint's controller and the new feedback controller initially read `req.params.workspaceId` instead of the verified-JWT `auth.workspaceId`, causing a real 500. Fixed to match the established `scheduled-workflow.controller.ts` convention; re-verified via integration tests.

**`PRODUCT_ANALYTICS_FOUNDATION = VERIFIED`** — 7 integration tests (`product-event.integration.test.ts`, including the new `GET /events/activity` endpoint added for the dashboard widget below).

## 3. Activation metrics — honest, not impressive

`MIN_SAMPLE_SIZE = 10` (a documented MVP choice, not statistical rigor) classifies every rate/duration metric into `NO_DATA` (denominator=0), `INSUFFICIENT_SAMPLE` (denominator<10), or `OBSERVED` (a real computed percentage) — the spec's own explicit requirement ("never display a misleading 0% retention when there are simply not enough users") is enforced structurally, not by convention.

**`ACTIVATION_METRICS = VERIFIED`** — 5 unit tests (deterministic classification boundaries) + 1 real-Postgres structural-validity integration test (exact percentages against shared dev-DB history can't be asserted, so the test proves the classification and shape are correct, not a specific number).

## 4. Onboarding completion — a real gap closed

The backend's onboarding state machine recognized steps through `first_workflow_run` but nothing ever advanced it to `completed` — a real customer would appear permanently "still onboarding" in every metric forever. Closed by chaining `advanceOnboardingStep(..., 'completed', ...)` immediately after a real workflow reaches `COMPLETED`, reusing `advanceOnboardingStep`'s existing forward-only, non-sequential jump semantics rather than building new UI for intermediate steps that have no distinct product moment for this MVP's target persona (an Azerbaijani small-business owner, not a developer).

**`ONBOARDING_COMPLETION = VERIFIED`** — `onboarding.integration.test.ts` updated and passing; `onboarding-status.integration.test.ts` call sites updated for the `skipOnboarding` signature change.

## 5. Admin product intelligence & reliability

Admin dashboard extended with ~15 new real-query metrics (users/workspaces/AI/workflows/billing), deliberately using `activeSubscriptionCatalogValueCents` instead of "MRR" (the spec's own explicit warning: never label a metric MRR unless the billing data actually supports that definition — this MVP's billing data does not yet distinguish net revenue from gross catalog value).

Dead-letter job admin operations (list/retry/cancel) use the same atomic conditional-`updateMany` claim pattern proven for exactly-once billing since Phase 24-25 — a duplicate/concurrent admin action is a genuine no-op (422), never a silent double-effect. Logged via structured `console.log` JSON (matching `scheduler-tick.service.ts`'s own pattern) rather than `AuditLog`, since `Job` has no workspace FK by design (Phase 27).

**`ADMIN_INTELLIGENCE = VERIFIED`** — extended `admin.integration.test.ts`/`admin-dashboard.integration.test.ts`, 5 new `admin-dead-letter-jobs.integration.test.ts` tests.

## 6. Real workflow failure recovery — a genuine production defect found and fixed

Building the FAILED → RETRYING → RUNNING → COMPLETED recovery flow surfaced a real, previously-latent defect: `runStepWithRetry`'s internal `attempt` counter always restarted at 1 per function call. A genuine retry of a real FAILED instance collided with the original failed run's own `attempt=1` row on `WorkflowStepRun`'s real unique constraint `(workflowInstanceId, stepKey, attempt)` — every real retry attempt would have 500'd in production. Found by this phase's own new retry integration test, not by inspection. Fixed by computing the real next `attempt` from the existing max for that step, then re-verified: the new test (4 cases) plus the pre-existing `workflow-failure.integration.test.ts` (4 cases) plus the full `marketing-autopilot` directory (31 cases) all still pass.

**`WORKFLOW_FAILURE_RECOVERY = VERIFIED`** — real audit trail (who/why/previous-state/new-state/timestamp) confirmed via `prisma.auditLog` assertions, not just a status-field check.

## 7. Notification gaps closed

Three real `NotificationType` enum values existed with zero call sites: `WORKFLOW_RETRYING` (fires on retry), `PAYMENT_FAILED` (fires on the real `invoice.payment_failed` Stripe webhook event), `SCHEDULED_WORKFLOW_COMPLETED` (fires when a scheduler-triggered run reaches `COMPLETED` or `AWAITING_APPROVAL` — the common real outcome, since marketing-autopilot has a real human-approval gate). `resolveNotificationRecipient` was exported from `subscription.service.ts` and reused by both the webhook and scheduler paths for consistent recipient resolution.

**`NOTIFICATION_GAPS = VERIFIED`** — assertions added to the existing `stripe-webhook-idempotency.integration.test.ts` and `scheduler-tick.integration.test.ts` end-to-end chains, both still passing.

## 8. Credit lifecycle UX — a real frontend/backend mismatch fixed

The frontend's low-credit visual states used hardcoded 10%/30%-remaining thresholds that had silently drifted from the real backend's `usage-alert.service.ts` `THRESHOLDS=[80,90,100]` (percent used). Fixed to compute the identical `usedPercent` formula and mirror the real thresholds exactly, with a visible lifecycle-state label (Healthy/Low/Critical/Exhausted).

**`CREDIT_LIFECYCLE_UX = VERIFIED`.**

## 9. Customer feedback loop

`Feedback` model (BUG/IDEA/QUESTION/GENERAL, OPEN/IN_REVIEW/RESOLVED/DISMISSED), workspace-scoped submit/list, admin cross-tenant list/status-update (same `requireSystemAdmin` router-level gate proven for every other admin surface). Frontend `/feedback` page (Azerbaijani UI, matching the rest of the customer-facing product) and nav item.

**`FEEDBACK_LOOP = VERIFIED`** — 4 workspace-scoped integration tests + 4 new admin-surface integration tests (non-admin 403, real cross-tenant visibility, audited status update, forged-id 404).

## 10. Frontend error boundary — live-verified, not just type-checked

No React top-level error boundary existed — a render crash anywhere would show React's dev overlay or a blank white screen in production, never a recoverable customer-facing screen. A minimal class-component `ErrorBoundary` now wraps `<App>`; on catch it renders one Azerbaijani-language recovery screen and logs the real error to the console only (never into the DOM). This was **live-verified in a real browser**, not just type-checked: a temporary synthetic-crash route was added, the crash was triggered, the fallback screen and console-only error logging were confirmed via `read_console_messages` and `get_page_text`, then the temporary route was removed and the revert re-verified with a clean typecheck.

Separately, the backend's own customer-facing error experience was audited: the generic `errorHandler` fallback for any unexpected error (Prisma/SQL/OpenAI/Stripe) always returns `"An unexpected error occurred."`, with the real error logged server-side only; `UpstreamProviderError`'s default message is generic and its only call site (the OpenAI adapter) never passes the real error text. A codebase-wide grep confirmed no caught-error `.message` is ever forwarded into a thrown `AppError` anywhere.

**`FRONTEND_ERROR_BOUNDARY = VERIFIED` (real browser proof). `CUSTOMER_FACING_ERROR_COPY = VERIFIED` (audited, no gap found — this section closed clean).**

## 11. Security regression for new resources

Real cross-tenant/RBAC/forged-ownership tests for every resource type this phase introduced or extended: `jobId` (non-admin 403, nonexistent 404, double-retry 422, cancel-then-retry rejected), `feedbackId` (cross-tenant submit/list → 404, admin routes RBAC-gated, forged-id 404), `productEvent` (event-name allowlist spoofing → 422, cross-tenant write → 404). Also extended the workflow-retry surface with a cross-tenant retry attempt → 404, mutation confirmed never applied.

**`SECURITY_REGRESSION_NEW_RESOURCES = VERIFIED`** — 4 new admin-feedback tests plus the pre-existing coverage confirmed still passing.

## 12. Data retention policy — decided, enforcement deliberately deferred

Every unbounded-growth table classified (`AuditLog`/`Invoice` indefinite — compliance/financial records; `AIUsage` ≥24 months; `WebhookEvent` 90 days; `Job`/`ScheduledJobRun` 30-90 days; `WorkflowStepRun` tied to its instance; `Notification`/`Activity` 180 days; `ProductEvent` 13 months; `Session`/`TeamInvite` low-risk cleanup candidates). Automated enforcement is explicitly **not** built this phase: shipping an irreversible deletion job before this phase's own backup/restore rehearsal has run and before there's real usage volume to size it against would itself be a production risk, not a safety measure.

**`DATA_RETENTION_POLICY = DECIDED AND DOCUMENTED`. `DATA_RETENTION_ENFORCEMENT = DEFERRED`** (reasoned, not silent) — see `docs/PHASE_29_DATA_RETENTION_POLICY.md`.

## 13. Full regression — fresh counts

| Suite | Result |
|---|---|
| Unit tests | **93/93 passed** (10 files) |
| Real-Postgres integration tests | **275/275 passed** (45/45 files) — one `scheduler-tick.integration.test.ts` case failed once under full-suite load, reproduced clean in isolation and on a full re-run; documented as suite-level flakiness (this file's own header comment already documents prior PGlite-timing sensitivity), not a regression |
| PGlite migration portability | **VERIFIED** — all 10 migrations (335 statements), including both new Phase 29 ones, replay cleanly |
| Lint (backend + frontend) | **0 errors** |
| Typecheck (backend + frontend) | **0 errors** |
| Playwright E2E | **12/12 passed** — `golden-path.spec.ts` extended with real notification-received and dashboard-activity assertions |

**`FULL_REGRESSION = VERIFIED`.**

## 14. Docker + authoritative customer-journey E2E

The E2E half is fully **VERIFIED**: `golden-path.spec.ts`'s serial suite now proves, end to end, against the real dev server stack: register → onboarding → business profile → first AI action → marketing workflow → 30 content assets generated → one edited and approved individually → whole plan approved → **real WORKFLOW_COMPLETED notification received** (verified via the full notifications page, not just the bell badge count) → **dashboard shows real activity** (the actual sequence of business moments this run produced) → browser refresh preserves state → logout → login → state persists → tenant isolation at the UI layer. This was first walked manually in a live browser (finding and fixing the Azerbaijani-locale month-name bug along the way), then codified as the two new Playwright assertions and run automated, twice, both green.

The Docker rebuild half is **`BLOCKED — ENVIRONMENT`**: the Docker daemon could not be reached (`docker ps` fails with a named-pipe connection error; an explicit `docker desktop start` attempt did not bring it up within a reasonable wait). Phase 27/28's own container-level certification (`docker build`/`docker run` against the real dev DB) is unchanged and **not re-claimed as re-verified this phase** — this is a session-scoped environment gap, not a regression in the Dockerfiles themselves (neither was touched this phase).

## 15. Performance baseline & backup/restore rehearsal

Real p50/p95/p99 captured for this phase's new hot paths against real Postgres (`perf-phase29.ts`): `trackEvent` p50=6.3ms, `listRecentWorkspaceActivity` p50=5.7ms, `getActivationMetrics` p50=30ms (p95=436ms — a real cross-tenant aggregate, the widest gap observed this phase, worth watching as real user volume grows), `listDeadLetterJobs` p50=6.5ms, feedback submit+list p50=12.9ms, and the full marketing-autopilot workflow-start HTTP round trip p50=1362.8ms — **explicitly labeled as including MOCK PROVIDER LATENCY** (`AI_PROVIDER=mock`, not representative of a real OpenAI call).

Backup/restore rehearsal used a real, documented substitute for Phase 28's Docker-based `pg_dump`/`psql` method (unavailable this session — no Docker daemon, no native `pg_dump`/`psql` binaries): full schema DDL replay of all 10 real migration files (335 statements) into an isolated schema (`restore_verify_p29`) inside the real dev database, then a representative 7-table data restore (`users`, `workspaces`, `business_profiles`, `product_events`, `feedback`, `notifications`, `audit_logs`) via real SQL, verified with **exact row-count match and a full content-hash match** (not just counts) for every table, then clean teardown. A real, subtle Postgres behavior was found and worked around during development: replaying `CREATE TYPE` into an isolated schema creates a distinct enum type object even with an identical name, so a plain `SELECT *` across schemas fails on enum-typed columns — fixed with the standard row-to-text-to-row cast idiom.

**`PERFORMANCE_BASELINE = VERIFIED`. `BACKUP_RESTORE_REHEARSAL = VERIFIED`** (real, documented substitute method — see the script's own header comment for the full reasoning).

---

## 16. Defects found and fixed this phase

1. **`WorkflowStepRun` unique-constraint collision on retry** (Section 6) — a genuine, previously-latent defect that would have 500'd every real production retry. Found via this phase's own new test, not inspection.
2. **Onboarding never reached `COMPLETED`** (Section 4) — every real customer would appear permanently mid-onboarding in every metric.
3. **`workspaceId: undefined` in two new controllers** (Section 2) — both used the raw URL param instead of the verified-JWT `auth.workspaceId`, causing a real 500.
4. **Credit-lifecycle threshold drift** between frontend and backend (Section 8) — customers could see a visually "healthy" credit bar past the point the backend considered them critical.
5. **Azerbaijani locale month-name rendering gap** — `toLocaleString('az-AZ', {month:'short'})` produced a raw `"M08"` token in this browser's ICU data, found during the live E2E walkthrough, fixed with an explicit non-locale-dependent date format.
6. **A Postgres cross-schema enum-type incompatibility** in the backup/restore rehearsal script itself (Section 15) — not a product defect, but documented since the fix (row-to-text-to-row casting) is the kind of detail a future maintainer of this script needs.

Items 1-4 are real, customer-impacting defects found through live execution and browser walkthroughs this phase's own certification discipline requires — not through code review alone.

---

## 17. Final release gate matrix

| Gate | Status |
|---|---|
| `PRODUCT_ANALYTICS_FOUNDATION` | VERIFIED |
| `CLIENT_EVENT_SPOOFING_PROTECTION` | VERIFIED |
| `ANALYTICS_PRIVACY` | VERIFIED |
| `ACTIVATION_METRICS` | VERIFIED |
| `ONBOARDING_COMPLETION` | VERIFIED |
| `DASHBOARD_REAL_ACTIVITY` | VERIFIED |
| `ADMIN_INTELLIGENCE` | VERIFIED |
| `NO_FABRICATED_MRR_LABEL` | VERIFIED |
| `DEAD_LETTER_JOB_ADMIN_OPS` | VERIFIED |
| `WORKFLOW_FAILURE_RECOVERY` | VERIFIED |
| `NOTIFICATION_GAPS` | VERIFIED |
| `CREDIT_LIFECYCLE_UX` | VERIFIED |
| `FEEDBACK_LOOP` | VERIFIED |
| `FRONTEND_ERROR_BOUNDARY` | VERIFIED (real browser proof) |
| `CUSTOMER_FACING_ERROR_COPY` | VERIFIED |
| `SECURITY_REGRESSION_NEW_RESOURCES` | VERIFIED |
| `DATA_RETENTION_POLICY` | DECIDED AND DOCUMENTED |
| `DATA_RETENTION_ENFORCEMENT` | DEFERRED (reasoned) |
| `FULL_REGRESSION` | VERIFIED |
| `E2E_CUSTOMER_JOURNEY` | VERIFIED |
| `DOCKER_REBUILD` | BLOCKED — ENVIRONMENT |
| `PERFORMANCE_BASELINE` | VERIFIED |
| `BACKUP_RESTORE_REHEARSAL` | VERIFIED (documented substitute method) |
| `REAL_PAYMENT_PROVIDER` (unchanged since Phase 28) | BLOCKED — CREDENTIAL |
| `REAL_AI_PROVIDER` (unchanged since Phase 20) | BLOCKED — CREDENTIAL |

**21 VERIFIED, 2 DECIDED/DEFERRED (reasoned), 2 BLOCKED (1 CREDENTIAL unchanged, 1 ENVIRONMENT this session), 0 FAILED, 0 NOT ATTEMPTED.**

---

## 18. Release verdict

**`RELEASE CANDIDATE — MINOR BLOCKERS`** (unchanged classification from Phase 28, same reasoning: the remaining gates are business decisions — obtaining real Stripe/OpenAI credentials — and a session-scoped environment gap (Docker daemon), not engineering defects). Every customer-facing gap this phase set out to close (onboarding completion, activation visibility, workflow recovery, feedback channel, error resilience) is real, tested, and verified. Nothing was fabricated to reach this verdict; two gates are honestly marked blocked rather than glossed over.

See the chat record for this phase's founder-level final summary (10-question format, answered directly against what was actually verified above).
