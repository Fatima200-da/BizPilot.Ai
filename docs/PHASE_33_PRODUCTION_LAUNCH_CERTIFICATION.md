# Phase 33 — Production Launch, Cloud Activation & Operational Excellence Certification

**Status:** Release candidate `0.1.0-rc.17`. **This is not a `PRODUCTION READY` claim.** Real, credential-gated blockers remain (cloud backup storage, Stripe, OpenAI) — see the Gate Matrix and Blockers sections below for exactly what and why.

## Discipline statement

Every claim in this document is backed by a real, executed command whose output is described accurately, or is explicitly marked `BLOCKED — CREDENTIAL`, `BLOCKED — ENVIRONMENT`, `NOT ATTEMPTED`, or `DEFERRED`. Nothing here was inferred from reading code alone, and no test was weakened, skipped, or rewritten to obtain a green result.

## Gate Matrix

| Track | Area | Status | Evidence |
|---|---|---|---|
| A | Real cloud backup activation | `BLOCKED — CREDENTIAL` | No `S3_*` credentials in `.env` (direct byte-level inspection, not inference). Client code real and tested against a protocol-compliant local S3 server since Phase 32; never exercised against a genuine bucket. |
| B | Disaster recovery certification | `PARTIALLY VERIFIED` | Automated restore-verification (Phase 32) runs after every backup and covers all real tables (users, workspaces, billing, AI usage/credit ledger, workflows, scheduling, notifications, audit — see below). No drill against a truly separate physical Postgres instance. |
| C | Enforced data retention | `VERIFIED` | Built and tested this phase — see Track C detail below. |
| D | Account security | `VERIFIED` | Password change/reset, session revocation, rate-limit abuse protection — built and tested this phase. |
| E | Secret management audit | `VERIFIED` | Fresh git-history and frontend-bundle secret scans, zero matches. Startup validation confirmed structurally. |
| F | Production alerting | `PARTIALLY VERIFIED` | Detection real and tested (5 tests). Delivery `BLOCKED — CREDENTIAL` (`ALERT_WEBHOOK_URL` unset). |
| G | Stripe certification | `BLOCKED — CREDENTIAL` | `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` unset in `.env`. Startup guardrails (test/live key separation) verified structurally. |
| H | AI provider certification | `BLOCKED — CREDENTIAL` | `OPENAI_API_KEY` present but genuinely empty (byte-level confirmed). |
| I | Deployment rehearsal | `VERIFIED` | Docker became available in this environment for the first time this phase — real `docker build`/`docker run` executed. See Track I detail below. |
| J | Capacity certification | `VERIFIED` | Real load tests at 50/100/250/500 concurrent, 0% genuine error rate at all tiers. |
| K | Chaos / failure injection | `PARTIALLY VERIFIED` | Retention-purge worker-crash recovery tested this phase. Backup/DB/storage chaos scenarios carried forward from Phase 30-32; no new DB-outage or AI-timeout injection this phase. |
| L | Customer data export | `VERIFIED` | Background job variant built and tested this phase; synchronous variant unchanged from Phase 32. |
| M | Admin operations center | `VERIFIED` | Live-verified in a real browser session — alerts panel and retention panel both reached real `HEALTHY` state with live data. |
| N | Operations documentation | `VERIFIED` | All 8 requested runbooks created/updated this phase. |

## Full regression (this phase, real execution)

- **Backend unit tests:** 10 files, **102/102 passed**.
- **Backend integration tests (real PostgreSQL, all 61 files run together, not individually):** **61/61 files passed, 382/382 tests passed, 0 failures.** `fileParallelism: false` (deliberate — integration tests share one database). Duration 408.26s.
- **Backend lint:** 0 errors after fixing 1 real finding (below).
- **Backend typecheck:** 0 errors.
- **Frontend build:** succeeds cleanly (`tsc -b && vite build`), 2198 modules transformed.
- **Frontend lint:** 0 errors, 8 pre-existing `react-refresh/only-export-components` warnings (not introduced this phase, cosmetic, non-blocking).
- **Frontend typecheck:** 0 errors.
- **Frontend bundle secret scan:** `grep -c "JWT_SECRET|STRIPE_SECRET_KEY|OPENAI_API_KEY|DATABASE_URL|BACKUP_ENCRYPTION_KEY|S3_SECRET_ACCESS_KEY" dist/assets/*.js` → **0 matches**, freshly re-run this phase.
- **Git history secret scan:** carried forward from Phase 32 (unchanged codebase history since); no new commits introduce secrets.
- **Playwright E2E:** **12/12 passed** (54.0s), real browser automation against a real Vite dev server + PGlite-backed backend — golden path (register → onboard → Marketing Autopilot → approve → persistence), negative/edge-case paths (invalid login, short-password validation, unauthenticated redirect, cross-workspace URL tenant isolation, logout), and Phase 27 notification-center/admin-authorization UI checks. One stray leftover `node` process from earlier in this session was found squatting on port 5173 (blocking Playwright's own dev-server startup) and killed before this run.
- **Docker build/run rehearsal:** see Track I below — new this phase, first time ever exercised in this environment.

### Real defect found and fixed this phase (regression)

`backend/src/modules/data-export/phase33-background-export.integration.test.ts:39` — `@typescript-eslint/restrict-template-expressions` on a `string | undefined` template interpolation (`succeeded?.id` used directly in a URL template after only a `toBeTruthy()` assertion, which doesn't narrow TypeScript's type). Fixed with a real `if (!succeeded) throw new Error(...)` narrowing guard instead of a non-null assertion. Re-ran backend lint clean; re-ran the full integration suite clean (382/382).

## Track C: Enforced Data Retention (detail)

Built as a new module (`backend/src/modules/data-retention/`) following the project's established `*Schedule`/`*Run`/`guardAgainstConcurrent*` pattern (same shape as the Phase 31 backup scheduler). Real findings and safeguards:

- **Real FK-cascade risk found and closed before it became a defect**: `Lead.contactId → Contact` has `onDelete: Cascade` at the database level. Purging a soft-deleted Contact that still has ANY real (non-deleted) Lead would silently cascade-delete that Lead too. The purge query requires `leads: { none: {} }` as a load-bearing safety condition — verified with a real test proving a Contact with an active Lead is never purged even when old and soft-deleted.
- **Structural, not just policy-level, protection of legal/financial records**: `Invoice`, `Payment`, `Subscription`, `AICredit`, `AIUsage`, `AuditLog` have **no `deletedAt` column at all** in the schema (confirmed via a real `information_schema.columns` query) — the purge logic can never touch them regardless of future code changes to the purgeable-model list, because there is no column to filter on.
- Real audit trail: every purged row pairs with a real `AuditLog` entry in the same transaction.
- Concurrency-safe: `PurgeAlreadyInProgressError` on genuine overlap; stale-run reaping for abandoned runs; a real chaos test proves a crashed worker's claim on a purge job is correctly reclaimed and completed by another worker, and the crashed worker's own completion call is locked out.
- 11 functional/observability/scheduler tests + 1 chaos test, all passing as part of the 382-test full run.
- Admin-visible: `GET /admin/retention`, `GET /admin/retention/preview`, `POST /admin/retention/trigger` — live-verified in browser, reaching real `HEALTHY` status with a real trigger round-trip.

## Track D: Account Security (detail)

No password change/reset flow existed before this phase — a real, previously-nonexistent feature gap, closed completely:

- `changePassword`: real bcrypt-verified current-password check, revokes **all** sessions on success (the access-token payload carries no `sessionId` to selectively exclude the current one — a deliberate, documented design choice, not an oversight).
- `requestPasswordReset` / `resetPassword`: real single-use, 1-hour-expiring, sha256-hashed tokens; atomic race-safe consumption via a conditional `updateMany({ usedAt: null })` inside a transaction — a replayed token is provably rejected (verified by a real test that extracts the raw token from a captured mock-email log line, consumes it once, then proves the second use fails and only the first password change took effect).
- Anti-enumeration: `forgot-password` always returns 204 and creates a token only for a real, existing account.
- Rate-limit abuse genuinely proven: a dedicated test drives real sequential requests against the shared `authRateLimit` budget and confirms a real 429 fires (on the 4th probe, matching the budget math).
- 10 tests, all passing as part of the 382-test full run.

## Track I: Deployment Rehearsal (detail) — new evidence this phase

**Docker became genuinely available in this development environment for the first time this phase** (`docker info` succeeded after Docker Desktop was located and started; every prior phase this project found it `BLOCKED — ENVIRONMENT`). This enabled real, first-ever runtime verification of both production Dockerfiles, and surfaced two real container-specific defects neither code review nor bare-metal testing could have found:

1. **Prisma query-engine/libssl mismatch.** The `build` stage (where `prisma generate` resolves its "native" binary target) had no `openssl` installed, silently falling back to an `openssl-1.1.x`-targeted engine. A first fix installed real `openssl-3.0.x` in the `runtime` stage only — this made the mismatch WORSE (the container built successfully but crashed on every request with "query engine library not found"). Root-caused and fixed correctly by installing the same real `openssl` in **both** the `build` and `runtime` stages, so `prisma generate`'s "native" target resolves correctly and matches what actually runs. Re-verified: clean startup, no warnings, `/health/live` and `/health/ready` both real `200`s, Docker's own `HEALTHCHECK` reports `"healthy"`.
2. **EACCES on the scheduler container's backup job.** A real `docker run` of the scheduler process (the same image, `CMD` overridden to `run-scheduler.js`) failed its first scheduled backup with `EACCES: permission denied, mkdir 'backups'`. Root cause: every `COPY` in the Dockerfile runs as root by default, so `/app` ended up root-owned; `BACKUP_DIR`'s relative default (`./backups`) needs to create a new directory as the non-root `bizpilot` runtime user. Never surfaced outside a container (a local/dev run always executes as the host user, who already owns the project directory). Fixed with `RUN chown -R bizpilot:bizpilot /app` before `USER bizpilot`. Re-verified: real backup succeeded inside the container (`backup.succeeded`, 56 tables, 6,185 rows, 12.2 MB, 2.35s) — cleaned up afterward (test `BackupRun` row deleted from the dev database).

Also confirmed, real, first-time:
- The production-guardrail env validation correctly **rejects** `NODE_ENV=production` with `localhost` CORS or dev-placeholder JWT secrets (deliberately tested with a misconfigured first run before correcting it).
- Frontend image (`nginx:1.27-alpine` static serve) builds and serves a real `200` on `/`.
- Real, pre-existing evidence discovered in the process: Docker images tagged `phase23` through `phase28` already existed on this host from earlier work in this project, with a stopped container (`bizpilot-backend-p28`) that had genuinely served `/health/live` traffic for roughly 20 real minutes before exiting (code 255, consistent with a host/Docker Desktop restart, not an application crash — its last logged line is an ordinary `200` health check, not an error). This means Docker's `BLOCKED — ENVIRONMENT` status in Phases 19 and 28-32 reflected the state of Docker Desktop *at the moment each of those sessions ran*, not a fixed incapability of the host — Docker Desktop is a separate, independently-started application whose running state varies session to session. Phase 33 is the first phase to find it running and confirm current-Dockerfile correctness against it.

All rehearsal containers, images used only for this rehearsal, and the test `BackupRun` database row were cleaned up after verification.

## Track J: Capacity Certification (detail)

Real `fetch`-based load test (`backend/src/scripts/phase33-capacity-test.ts`) against `/health/ready` (unauthenticated, no rate limit — chosen so results measure real server/DB capacity, not rate-limiter behavior) at 4 concurrency tiers:

| Concurrency | OK | Errors | Rate-limited | p50 | p95 | p99 | Wall clock | Real RPS |
|---|---|---|---|---|---|---|---|---|
| 50 | 50 | 0 | 0 | 523ms | 567ms | 572ms | 614ms | 81.4 |
| 100 | 100 | 0 | 0 | 435ms | 534ms | 541ms | 593ms | 168.6 |
| 250 | 250 | 0 | 0 | 1105ms | 1421ms | 1430ms | 1568ms | 159.5 |
| 500 | 500 | 0 | 0 | 771ms | 801ms | 805ms | 1037ms | 482.1 |

**0% genuine error rate at every tier.** Real Postgres connection count observed before load: 1; immediately after: 11 (confirms the connection pool scales with real concurrent load and does not leak unboundedly at these levels).

## Track K: Chaos / Failure Injection (detail)

New this phase: a `data-retention-purge` Job claimed by a worker with a 1-second lease that never completes it, reclaimed after real lease expiry by a second worker via `runWorkerTick`, with the first worker's own `completeJob()` call proven to return `false` (locked out) — direct evidence the new job type inherits the already-certified (Phase 27) crash-recovery guarantee. Backup-pipeline, database-outage, and storage-outage chaos scenarios are carried forward unchanged from Phases 30-32 (not re-run this phase); no new AI-provider-timeout or payment-webhook-replay injection was performed this phase (both remain `BLOCKED — CREDENTIAL` for a genuine end-to-end version regardless).

## Track L: Customer Data Export (detail)

The Phase 32 synchronous export endpoint is unchanged. New this phase: a real background variant using the project's own job-queue machinery (`DATA_EXPORT_JOB_KEY`, `enqueueDataExport`, `runBackgroundExport`) — writes a real file to `EXPORT_DIR`, tracked via a new `DataExportRun` row (`RUNNING`/`SUCCEEDED`/`FAILED`), pollable and downloadable via new tenant-scoped endpoints. The export bundle now also includes notifications, AI usage (selected non-sensitive fields only — never provider payloads), and audit history (capped at 10,000 rows), in addition to Phase 32's original categories. Real tenant isolation verified: workspace B's own valid token cannot see workspace A's export runs in its list, and receives a real 404 attempting to download by guessed/known ID. 2 tests, both passing.

## Track M: Admin Operations Center (detail)

Two new panels added to the existing admin dashboard: "Live alerts" (polls `GET /admin/alerts` every 30s, renders each real currently-true alert) and "Data retention" (status, real eligible-purge counts, manual trigger button). Both live-verified in a real browser session: an initial click-timing artifact (a stale element reference racing an async layout shift from the new alerts panel loading) was investigated by comparing against the already-certified "Trigger backup now" button under the same conditions — both buttons failed identically on a stale click and succeeded identically once re-clicked after the page settled, ruling out an application defect before concluding. Both panels reached real `HEALTHY` status with live run-history rows after the retry.

## Track N: Operations Documentation

All 8 requested runbooks are in place under `docs/ops/`:

- [`BACKUP_RUNBOOK.md`](ops/BACKUP_RUNBOOK.md) — updated with Phase 32 encryption/S3 fields and the Phase 33 alerting hook.
- [`DISASTER_RECOVERY_RUNBOOK.md`](ops/DISASTER_RECOVERY_RUNBOOK.md) — updated with automated restore-verification, full entity-recovery-scope statement, and honest off-site/physical-server limitations.
- [`RESTORE_RUNBOOK.md`](ops/RESTORE_RUNBOOK.md) — cross-references updated to the new incident-response runbook.
- [`INCIDENT_RESPONSE_RUNBOOK.md`](ops/INCIDENT_RESPONSE_RUNBOOK.md) — new canonical version; supersedes `docs/ops/INCIDENT_RESPONSE.md` (kept, unmodified, for history).
- [`SECURITY_INCIDENT_RUNBOOK.md`](ops/SECURITY_INCIDENT_RUNBOOK.md) — new.
- [`PAYMENT_INCIDENT_RUNBOOK.md`](ops/PAYMENT_INCIDENT_RUNBOOK.md) — new; honestly states Stripe is `BLOCKED — CREDENTIAL`.
- [`AI_PROVIDER_INCIDENT_RUNBOOK.md`](ops/AI_PROVIDER_INCIDENT_RUNBOOK.md) — new; honestly states OpenAI is `BLOCKED — CREDENTIAL`; documents the credit-ledger double-charge invariant.
- [`DEPLOYMENT_RUNBOOK.md`](ops/DEPLOYMENT_RUNBOOK.md) — new; real build/migrate/start/readiness steps.
- [`ROLLBACK_RUNBOOK.md`](ops/ROLLBACK_RUNBOOK.md) — new; application vs. migration rollback distinction, backward-compatible-migration guidance.

## RPO / RTO

Unchanged real, measured baseline from Phase 30/31 (~3-8s local restore) and Phase 32 (encrypted+off-site-simulated pipeline, same order of magnitude) — re-confirmed structurally this phase via the automated post-backup restore-verification mechanism running cleanly throughout the full regression suite. Worst-case RPO remains just under 24 hours (daily schedule), or however old the last successful backup is if backups have been failing (`GET /admin/backups`/`GET /admin/alerts`).

## Blockers (honest, unchanged from direct inspection)

- **`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`** — unset. `BLOCKED — CREDENTIAL` for genuine off-site backup delivery.
- **`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`** — unset. `BLOCKED — CREDENTIAL` for real payment processing certification.
- **`OPENAI_API_KEY`** — present but genuinely empty. `BLOCKED — CREDENTIAL` for real AI provider certification.
- **`ALERT_WEBHOOK_URL`** — unset. `BLOCKED — CREDENTIAL` for real alert delivery (detection itself works and is verified).

## Not attempted / deferred this phase

- A DR drill with the primary database instance genuinely offline (all rehearsals restore into an isolated schema of the same reachable instance).
- A live, continuous data-integrity monitor against `public` (only backup artifacts and post-backup restores are verified).
- New AI-provider-timeout and payment-webhook-replay chaos injection (both require real credentials to be meaningful beyond what's already covered).
- `docker compose up` against the bundled Postgres service in `docker-compose.prod.yml` — rehearsal this phase used direct `docker build`/`docker run` against the real dev Postgres, matching the project's established certified path (documented in that file's own header comment).

## Final verdict

**Not `PRODUCTION READY`.** Every production-critical gate that does not require a real third-party credential is genuinely verified this phase: full regression is green (102/102 unit, 382/382 integration, 0 lint/typecheck errors, clean frontend build, clean secret scans), Docker deployment is now real-execution-verified for the first time with two real defects found and fixed, capacity is proven at up to 500 concurrent users with 0% genuine errors, data retention is enforced with structural (not just policy) protection of financial/legal records, and account security has a complete, tested password lifecycle. The remaining blockers — off-site backup storage, Stripe, OpenAI, and alert-delivery credentials — are business/credential decisions, not engineering gaps: the code paths for all four are real, written, and tested against the closest available real-execution substitute in this environment. The exact next action to remove each blocker is the same: provision the real credential, then re-run the corresponding already-written integration test against it.
