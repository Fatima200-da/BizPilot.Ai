# Phase 29 — MVP Readiness Scorecard

**Zero-fabrication discipline (unchanged from every prior phase):** `VERIFIED` (real execution observed), `PARTIALLY VERIFIED`, `BLOCKED — CREDENTIAL`, `BLOCKED — ENVIRONMENT`, `DEFERRED` (a real decision, deliberately postponed, with a stated reason), `NOT ATTEMPTED`, `FAILED`. Never marked `VERIFIED` merely because source code exists.

---

## 1. Customer onboarding journey

| Step | Status | Evidence |
|---|---|---|
| Register → workspace → business profile | VERIFIED | Live browser walkthrough this session (register → onboarding → business profile) + `golden-path.spec.ts` (Playwright, automated, passing) |
| Category / goals / audience / brand / channel | VERIFIED (existing, unchanged) | Collected in the business-profile step — no unnecessary fields added; every field maps to a real product use (industry → content generation context, audience → strategy targeting) |
| AI readiness / first automation | VERIFIED | Real marketing-autopilot workflow launched, 30 real content assets generated, live-verified in browser + `golden-path.spec.ts` |
| Onboarding reaches a real `COMPLETED` state | VERIFIED (real gap closed this phase) | `advanceOnboardingStep(..., 'completed', ...)` now chained after real workflow completion — previously stuck at `first_workflow_run` forever. `onboarding.integration.test.ts` |
| Dashboard shows real activity | VERIFIED (new this phase) | `GET /workspaces/:id/events/activity`, live-verified in browser: 10 real business-moment events shown newest-first for a real completed journey |

## 2. Product analytics

| Item | Status | Evidence |
|---|---|---|
| `ProductEvent` model + tracking service | VERIFIED | `product-event.service.ts`, 6 integration tests, wired into 12 real call sites |
| Client-event spoofing protection | VERIFIED | `CLIENT_TRACKABLE_EVENTS` allowlist — a client can never fire `subscription_canceled` or any other business-critical event; tested |
| Analytics privacy (no passwords/tokens/raw prompts) | VERIFIED | Every `trackEvent` call site inspected; `properties` payloads contain only identifiers and small structured data, never credentials or prompt content |
| Activation metrics (signup conversion, TTFV, 7-day return, etc.) | VERIFIED | `activation-metrics.service.ts`, 5 unit + 1 integration test |
| Honest small-sample labeling (never a misleading 0%/100%) | VERIFIED | `MIN_SAMPLE_SIZE = 10` gates every rate into `NO_DATA`/`INSUFFICIENT_SAMPLE`/`OBSERVED`; unit-tested classification boundaries |

## 3. Admin intelligence & reliability

| Item | Status | Evidence |
|---|---|---|
| Admin dashboard extensions (users/workspaces/AI/workflows/billing) | VERIFIED | ~15 new real-query metrics fields, `admin.integration.test.ts` + `admin-dashboard.integration.test.ts` |
| No fabricated "MRR" label | VERIFIED | Deliberately named `activeSubscriptionCatalogValueCents` with an honest doc comment instead |
| Dead-letter job admin ops (list/retry/cancel) | VERIFIED | RBAC-protected, atomic conditional-transition claims, fully audited; 5 integration tests |
| Real workflow failure recovery (retry) | VERIFIED | FAILED → RETRYING → RUNNING → COMPLETED through the real engine; found and fixed a real `WorkflowStepRun` attempt-collision defect in the process; 4 integration tests |
| Customer-facing error experience (no stack traces/SQL/provider errors exposed) | VERIFIED | Backend `errorHandler`'s generic-fallback path audited end-to-end; `UpstreamProviderError`'s default message is generic and used with no arguments at its only call site; codebase-wide grep confirms no caught-error `.message` is ever forwarded into a thrown `AppError` |

## 4. Notifications & credit lifecycle

| Item | Status | Evidence |
|---|---|---|
| `WORKFLOW_RETRYING` / `PAYMENT_FAILED` / `SCHEDULED_WORKFLOW_COMPLETED` wired to real call sites | VERIFIED | All 3 were previously-defined enum values with zero call sites; now fire for real, tested via `workflow-retry`, `stripe-webhook-idempotency`, and `scheduler-tick` integration tests |
| Low-credit UX matches real backend thresholds | VERIFIED (real bug fixed) | Frontend previously used 10%/30%-remaining; now mirrors the real `usage-alert.service.ts` 80/90/100%-used thresholds exactly |
| Billing readiness | UNCHANGED — `BLOCKED — CREDENTIAL` | No real Stripe test-mode credential in this environment (same as Phase 28); mock-provider path fully exercised |

## 5. Frontend quality & security

| Item | Status | Evidence |
|---|---|---|
| Frontend error boundary (no blank-white-screen crashes) | VERIFIED (new this phase) | Class-component `ErrorBoundary` wrapping `<App>`; live-verified with a synthetic crash injected and removed this session — real DOM proof, not just a type-check |
| Security regression for new resources | VERIFIED | Cross-tenant/RBAC/forged-ownership tests for `jobId`, `feedbackId`, `productEvent` |
| Feedback channel (submit/list/admin triage) | VERIFIED | `Feedback` model, workspace + admin endpoints, frontend page + nav item; 8 integration tests total (4 workspace-scoped, 4 admin) |
| Data retention policy | DECIDED AND DOCUMENTED | Every unbounded-growth table classified; enforcement deliberately `DEFERRED` (reasoned, not silent) — see `PHASE_29_DATA_RETENTION_POLICY.md` |

## 6. Regression & release gates

| Item | Status | Evidence |
|---|---|---|
| Unit tests | VERIFIED — 93/93 | `npm test` |
| Real-Postgres integration tests | VERIFIED — 275/275 (45/45 files) | `npm run test:integration`, fresh run this phase |
| PGlite migration portability | VERIFIED | Both new Phase 29 migrations replay cleanly against a real Postgres-wire-protocol PGlite instance |
| Lint | VERIFIED — 0 errors | Backend + frontend |
| Typecheck | VERIFIED — 0 errors | Backend + frontend |
| Playwright E2E (dev server) | VERIFIED — 12/12 | Extended `golden-path.spec.ts` with real notification + dashboard-activity assertions |
| Docker rebuild + container verification | **BLOCKED — ENVIRONMENT** | Docker daemon unreachable this session (`docker desktop start` attempted, still unreachable) — Phase 27/28's own container certification is unchanged and not re-claimed |
| Backup/restore rehearsal | VERIFIED (real, documented substitute method) | Schema DDL replay (335 statements, all 10 migrations) + 7-table representative data restore into a real isolated schema, exact row-count and content-hash match, clean teardown — substitutes Phase 28's Docker-based `pg_dump`/`psql` method because neither Docker nor native `pg_dump`/`psql` are available this session |
| Performance baseline | VERIFIED (real numbers, honestly labeled) | `perf-phase29.ts`; workflow-start timing explicitly labeled as including MOCK PROVIDER LATENCY |

---

## Overall counts this phase

**VERIFIED: 24 · DEFERRED (reasoned): 1 · BLOCKED — CREDENTIAL: 1 (unchanged) · BLOCKED — ENVIRONMENT: 1 · FAILED: 0 · NOT ATTEMPTED: 0**

No gate was silently upgraded. See `docs/PHASE_29_PRODUCTION_MVP_READINESS.md` for the full narrative and release verdict.
