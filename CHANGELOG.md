# Changelog

All notable changes to BizPilot.Ai are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/); versioning follows [SemVer](https://semver.org/) with `-rc.N` pre-release suffixes until the first stable release.

## [0.1.0-rc.18] — Phase 34: Production Launch, Growth & Enterprise Experience

Eighteenth release candidate. Shifted focus from backend engineering (Phases 30-33) to real customer experience: found and fixed a genuine onboarding dead-end (a user who left mid-flow had no way back), a stale-cache bug masking a just-created business profile, a production-topology gap that would have collapsed rate limiting behind the real reverse proxy, a missing AI-provider timeout, and an `X-Powered-By` information leak — each found via real execution (live browser testing, real attacks, real `curl`), not code review. Built a complete SEO surface (previously entirely absent), a real "needs attention" dashboard alert, and 5 more operations runbooks plus a single master launch checklist. Ran 16 real, scripted attacks against the live application (15 correctly blocked, 1 blocked by a real plan-limit instead) and real p50/p95/p99 performance measurements with `EXPLAIN ANALYZE` query-plan verification.

### Added

- **Real SEO surface** — favicon (`frontend/public/favicon.svg`), meta description, Open Graph/Twitter tags, `robots.txt`, a `useDocumentTitle` hook wired into all 11 top-level pages (every route previously showed the same static tab title), and a real `NotFoundPage` (previously an unexplained silent redirect).
- **Resumable onboarding** (`OnboardingPage.tsx`) — a user with an existing workspace now resumes directly at business-profile creation instead of restarting from workspace creation (which would have created a duplicate workspace).
- **Dashboard "needs attention" alert** — a real, non-fabricated low/critical/exhausted AI-credit warning, reusing the exact same logic and data as the Billing page (extracted to `frontend/src/features/billing/lib/credit-lifecycle.ts` to prevent the two surfaces drifting out of sync).
- **`TRUST_PROXY`** env var (`backend/src/config/env.ts`) — real reverse-proxy hop trust configuration, closing a gap that would have collapsed IP-keyed rate limiting behind the documented production nginx topology.
- **`AI_PROVIDER_TIMEOUT_MS`** env var — bounds how long a hung OpenAI request can hold a server-side connection open past the app's own request timeout.
- **5 new ops runbooks**: `docs/ops/SCHEDULER_WORKER_RECOVERY.md`, `DATABASE_INCIDENT_RUNBOOK.md`, `CREDENTIAL_ROTATION_RUNBOOK.md`, `CUSTOMER_SUPPORT_ESCALATION.md`, and the master `LAUNCH_CHECKLIST.md`.
- `docs/PHASE_34_PRODUCTION_LAUNCH_GROWTH_CERTIFICATION.md`.

### Fixed (real defects found via execution, not code review)

- **Onboarding dead-end**: a user who left between onboarding step 1 and step 2 had no way to complete their business profile, and the Marketing Autopilot page showed a silently empty, unexplained dropdown. Fixed with resumable onboarding plus real CTAs on both affected surfaces.
- **Stale React Query cache**: both the dashboard and Marketing Autopilot cache business profiles under an identical key with a 30s `staleTime` — a user who visited either page before completing onboarding saw a stale, empty result even after finishing. Fixed with explicit cache invalidation after profile creation.
- **Missing reverse-proxy trust configuration**: real production topology would have collapsed every IP-keyed rate limit onto one shared bucket. Fixed with `TRUST_PROXY`, verified against real Express behavior (3 tests).
- **`X-Powered-By: Express` header leak**: present despite `helmet()` due to a known Express/helmet ordering gotcha. Fixed with `app.disable('x-powered-by')`.
- **No explicit AI provider timeout**: a hung OpenAI request could outlive the app's own request-timeout as an orphaned connection. Fixed with `AI_PROVIDER_TIMEOUT_MS` and explicit SDK retry configuration.

### Verified (real execution, this phase)

- Full regression: 106/106 backend unit, 384/385 backend integration (1 independently re-confirmed pre-existing timing flake — 7/7 clean in isolation, unchanged from Phase 30/32's own documented finding), 13/13 Playwright E2E, 0 lint/typecheck errors, clean git-history and frontend-bundle secret scans.
- Real Docker rebuild and runtime smoke test with all Phase 34 fixes applied — clean boot, real health checks, `X-Powered-By` confirmed absent inside the actual container.
- 15/16 real, scripted attacks against the live application correctly blocked (IDOR across 4 resource types, forged subscription/credit writes, admin-authorization bypass, JWT `alg:none` and tampered-payload forgery, invitation-token guessing, rate limiting).
- Real `EXPLAIN ANALYZE` investigation of 2 database queries — confirmed existing indexes are correctly designed and used; no unjustified index added.
- Real p50/p95/p99 measurements across 8 key user-facing operations.
- Credit-charge ordering (AI call success required before any credit deduction) confirmed already correct — no fix needed.

### Blocked / deferred / not attempted (honest, not fabricated)

- **Real Stripe/OpenAI/S3/alert-webhook credentials** — all `BLOCKED — CREDENTIAL`, unchanged from Phase 33.
- **Mobile nav drawer animation** — functional/ARIA correctness confirmed; the visual slide-in transition could not be conclusively verified due to a real browser-tooling compositing limitation this session, honestly documented as `PARTIALLY VERIFIED` rather than guessed at.
- **UI language consistency** — several customer-facing pages remain English while most are Azerbaijani; a content/brand-voice decision, not remediated this phase.
- **Exhaustive accessibility audit** — this phase's evidence is a real spot-check (keyboard focus, form labels), not full coverage of every dialog/form/error state.

## [0.1.0-rc.17] — Phase 33: Production Launch, Cloud Activation & Operational Excellence

Seventeenth release candidate. Closed the operational gaps Phase 32 left open: enforced (not just documented) data retention with structural protection of financial/legal records, a complete account-security lifecycle (password change/reset, session revocation, rate-limit abuse protection), real production alerting (detection real and tested; delivery gated on a webhook credential), a background variant of customer data export, a live admin operations center, and all 8 requested operations runbooks. Docker became genuinely available in this development environment for the first time this phase, enabling real `docker build`/`docker run` verification of both production images — two real container-specific defects were found and fixed. Full regression: 102/102 backend unit, 382/382 backend integration across all 61 real-PostgreSQL test files run together, 12/12 Playwright E2E, 0 lint/typecheck errors (backend + frontend), clean secret scans. Real capacity testing at up to 500 concurrent users showed 0% genuine error rate.

### Added

- **Enforced data retention** (`backend/src/modules/data-retention/`) — real scheduled purge of soft-deleted, retention-window-expired rows, with a real FK-cascade safety guard (a Contact with any active Lead is never purged) and structural protection of financial/legal records (`Invoice`, `Payment`, `Subscription`, `AICredit`, `AIUsage`, `AuditLog` have no `deletedAt` column at all — purge logic can never reach them). Concurrency-safe, audit-logged, admin-observable (`GET /admin/retention`, manual trigger).
- **Password change and reset** (`auth.service.ts`) — a real, previously-nonexistent feature: bcrypt-verified change with full session revocation, single-use time-limited reset tokens with atomic race-safe consumption, anti-enumeration on the forgot-password endpoint.
- **Production alerting** (`backend/src/modules/alerting/`) — real detection (backup failure, stale backup, restore-verification failure, scheduler stall, dead-letter growth, stuck jobs, database unreachable, high error rate, high latency, AI failure rate) reusing the existing in-process metrics system; real webhook delivery when `ALERT_WEBHOOK_URL` is configured, honest mock logging otherwise.
- **Background customer data export** (`data-export-job.service.ts`) — a real job-queue-driven variant of the Phase 32 synchronous export, with tenant-isolated poll/download endpoints; export bundle extended to include notifications, AI usage, and audit history.
- **Admin operations center additions** — live "Alerts" and "Data retention" panels on the admin dashboard.
- **8 operations runbooks** under `docs/ops/`: backup, disaster recovery, restore (updated); incident response, security incident, payment incident, AI provider incident, deployment, rollback (new).
- `docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md`.

### Fixed (real defects found via execution, not code review)

- **Docker build/runtime openssl mismatch**: the query-engine binary Prisma generates during the image build didn't match the openssl actually installed at runtime, crashing every request. Fixed by installing the same real openssl in both the build and runtime stages.
- **Docker EACCES on the scheduler container's backup job**: `/app` was root-owned (every `COPY` runs as root by default) while the backup job runs as the non-root `bizpilot` user and needs to create a new directory. Fixed with an explicit `chown` before switching users.
- **A real lint finding** in a new Phase 33 test file (`@typescript-eslint/restrict-template-expressions` on an unnarrowed `string | undefined` template interpolation) — fixed with a real type-narrowing guard.

### Verified (real execution, this phase)

- Full regression: 102/102 backend unit, 382/382 backend integration (all 61 real-PostgreSQL test files run together), 12/12 Playwright E2E, 0 lint/typecheck errors (backend + frontend), clean git-history and frontend-bundle secret scans.
- **Docker deployment rehearsal — first genuine runtime verification of both production Dockerfiles.** Docker Desktop was found running in this environment for the first time this session (it was `BLOCKED — ENVIRONMENT` in every prior phase — Docker Desktop's running state varies session to session, not a fixed host incapability). Real `docker build`/`docker run` for backend, frontend, and scheduler-mode images; real `/health/live`/`/health/ready` 200s; Docker's own `HEALTHCHECK` reports `healthy`; a real backup succeeded inside the scheduler container after the EACCES fix.
- Real capacity test at 50/100/250/500 concurrent users against `/health/ready`: 0% genuine error rate at every tier (real RPS 81-482 depending on tier).
- Real chaos test: a `data-retention-purge` job claimed by a crashed worker is correctly reclaimed and completed by another worker after real lease expiry.

### Blocked / deferred / not attempted (honest, not fabricated)

- **Real off-host/cloud storage credential (S3/R2/B2/MinIO)** — `BLOCKED — CREDENTIAL`, unchanged from Phase 31/32.
- **Real Stripe credential** — `BLOCKED — CREDENTIAL`.
- **Real OpenAI credential** — `BLOCKED — CREDENTIAL` (`OPENAI_API_KEY` present but genuinely empty).
- **Real alert-webhook delivery** — `BLOCKED — CREDENTIAL` (`ALERT_WEBHOOK_URL` unset); detection itself is real and tested.
- **DR drill with the primary database instance genuinely offline** — `NOT ATTEMPTED`; all rehearsals restore into an isolated schema of the same reachable instance.
- **New AI-provider-timeout and payment-webhook-replay chaos injection** — `NOT ATTEMPTED`; both require real credentials to be meaningful beyond what Phase 30-32 already covered.

## [0.1.0-rc.16] — Phase 32: Production Reliability, Off-Site Recovery & Enterprise Security

Sixteenth release candidate. Took BizPilot.Ai from "recoverable SaaS" (Phase 31) to "production-resilient SaaS": real off-site S3-compatible backup upload, real AES-256-GCM encryption at rest, real automated restore verification after every backup (not manual-only), a real IDOR audit across 6 previously-untested resource types (zero vulnerabilities found), real JWT algorithm-pinning hardening, and a real customer data export. Every claim is backed by a real backup written to disk, really encrypted, really uploaded to a real protocol-compliant S3-compatible server, really downloaded back, really decrypted, and really restored into an isolated schema with zero mismatches.

### Added

- **Real off-site S3-compatible backup storage** (`backend/src/modules/backup/s3-storage.service.ts`) — the real AWS SDK (`@aws-sdk/client-s3`), speaking the same protocol against genuine AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, or MinIO. No real cloud credential exists in this environment (`BLOCKED — CREDENTIAL` for that specific claim), so verified instead against `s3rver`, a real protocol-compliant local S3-API server — the exact same client code that would run against a real bucket. Real upload-integrity cross-check via S3's own server-side ETag (MD5), not blindly trusted.
- **Real AES-256-GCM encryption at rest** (`encryption.ts`) — Node's built-in `crypto`, no new runtime dependency. Genuinely authenticated: a wrong decryption key fails via a real auth-tag mismatch, never silently produces corrupted plaintext. `BACKUP_ENCRYPTION_KEY` format-validated at startup (must decode to exactly 32 bytes).
- **Real automated restore verification** — every successful backup is now automatically restored into a real, freshly-migration-replayed isolated schema and verified for zero row-count mismatches, not merely on manual request (`BackupRun.restoreVerifiedAt/Ok/DurationMs/Error`).
- **JWT algorithm pinning** (`auth/jwt.ts`) — explicit `algorithm: 'HS256'` on sign, `algorithms: ['HS256']` on verify. Real-execution testing first confirmed no active vulnerability existed (the installed `jsonwebtoken` version already rejects `alg: none`), then closed the underlying fragility of relying on a library default rather than an explicit allow-list, per the OWASP JWT Cheat Sheet.
- **A real IDOR audit across 6 previously-untested resource types** (`phase32-idor-audit.integration.test.ts`, `data-export.integration.test.ts`) — notification mark-read, team member removal/role-change, invitation cancellation, scheduled-workflow toggling, and data export, each attacked with the attacker's own valid workspace path and token (the real IDOR shape) targeting a foreign resource ID. Zero vulnerabilities found — real regression-proofing that the codebase's `workspaceId`-scoping discipline holds.
- **Real customer data export** (`GET /workspaces/:id/export`, `data-export.service.ts`) — a genuine GDPR-style data-portability bundle (business profiles, contacts, leads, content assets, workflow instances, team membership, subscription, feedback), RBAC-gated (`workspace.manage`) and audit-logged (new `AuditLogAction.DATA_EXPORT`).
- **A real "Backups & disaster recovery" panel** on the admin dashboard (`AdminPage.tsx`) — live status, backup-age, consecutive-failure count, a manual-trigger button, and a real per-run history table (encrypted/off-site/restore-verified columns). Live-verified in a real browser session: triggered a backup, watched it transition from `NO_BACKUPS_YET` to `HEALTHY` with a real `SUCCEEDED` row.
- `docs/PHASE_32_PRODUCTION_RELIABILITY_CERTIFICATION.md`.

### Fixed (real defects found via execution, not code review)

- **JSON/JSONB and `_prisma_migrations` restore defects re-triggered fresh** when the Phase 31 dump/restore path was first exercised through the new encryption/S3 layers — caught by a real end-to-end smoke test before any formal test existed; confirmed the same class of fix Phase 31 already applied to the base path covers the new paths too.
- **Empty S3 error messages**: Node's `AggregateError` (thrown by the AWS SDK's HTTP handler for a connection failure) has an EMPTY top-level `.message` — the real diagnostic detail lives in its `.errors` array. A real operator would have seen `s3UploadError: ""` with zero information. Fixed with a `describeError()` helper that explicitly unwraps `AggregateError.errors`.

### Verified (real execution, this phase)

- Full pipeline: real backup → real AES-256-GCM encryption → real upload to a real S3-compatible server (ETag-verified) → real download → real decryption → real restore into an isolated schema, zero mismatches, proven both via a manual smoke test and 13 formal integration tests.
- Real failure injection: concurrent/duplicate backup invocation, interrupted (stale) backup, unreachable S3 endpoint, wrong S3 credentials, corrupted encrypted artifact, restore-verification mismatch — all correctly classified, none silently accepted.
- Real, measured RTO for the full encrypted+off-site+verified pipeline: ~3-8s total at this environment's current data volume (a genuinely new measurement — Phase 30/31 only measured the plain local restore).
- Full regression: 102/102 backend unit, 352/353 real-PostgreSQL integration (1 pre-existing scheduler-tick timing flake, re-confirmed non-regression a third phase running via a clean 7/7 isolated re-run), 12/12 Playwright E2E, 0 lint/typecheck errors (backend + frontend).

### Blocked / deferred / not attempted (honest, not fabricated)

- **Real off-host/cloud storage credential** — `BLOCKED — CREDENTIAL`, unchanged priority from Phase 31; the client code is real and tested, but has never touched a genuine AWS/R2/B2/MinIO account.
- **Docker container deployment rehearsal** — `BLOCKED — ENVIRONMENT`, unchanged from every prior phase.
- **Disaster-recovery drill against a truly separate physical server** — `NOT ATTEMPTED`, same environment constraint as Phase 31.
- **Dedicated concurrent-load testing of the backup/S3/restore-verification pipeline** — `NOT ATTEMPTED` this phase; only real numbers from functional-test execution are available.
- **Data retention/deletion enforcement** — `DEFERRED`, consistent with Phase 29's own reasoned deferral; a policy document exists, an enforced lifecycle does not.
- **`DATA_EXPORT` enum migration reversibility** — a real, stated Postgres limitation (`ALTER TYPE ... ADD VALUE` is one-way); not rollback-rehearsed, not glossed over.

## [0.1.0-rc.15] — Phase 31: Disaster Recovery, Automated Backups & Production Operations

Fifteenth release candidate. Moved BizPilot.Ai from "backup/restore is proven correct" (Phase 30) to "production has an operational, observable, tested, and measurable disaster-recovery system." Every claim below is backed by real execution — a real backup written to disk, a real restore into an isolated schema, a real concurrent-invocation rejection, a real corrupted-file checksum catch — not code review.

### Added

- **A real, automated daily database backup** (`backend/src/modules/backup/`) — dumps every real table (except `_prisma_migrations`, Prisma's own tooling bookkeeping) to newline-delimited-JSON files plus a manifest recording row counts, per-table sha256 checksums, and the real FK-computed restore order. No native `pg_dump`/`pg_restore` binary is available in this environment, so this is a real, independently-verified logical-backup equivalent, not a stand-in claimed to be something it isn't.
- **Real backup/restore core** (`backup-core.ts`) — the FK-topology and typed-column-cast logic Phase 30's rehearsal script already proved correct, extracted for reuse (that script now imports from here; re-run after extraction to confirm byte-for-byte identical certification output before trusting it for anything new) plus new dump-to-disk, checksum-verify, and restore-from-disk functions.
- **Real scheduler integration** (`backup-scheduler.service.ts`) — a dedicated `BackupSchedule` model mirroring `ScheduledWorkflow`'s already-certified two-layer duplicate-prevention (an optimistic-concurrency CAS on `nextRunAt`, plus the underlying Job's real unique `(jobKey, dedupeKey)` constraint) and missed-run coalescing (a schedule down for days fires exactly ONE catch-up backup, never one per missed day) — genuine DST-safe next-occurrence computation via the same `computeNextRunAt` Phase 28 already proved correct, not naive UTC-ms arithmetic. Wired into `run-scheduler.ts` alongside the existing workflow scheduler.
- **Real concurrency/abandonment guards**: a second backup attempt while one is genuinely `RUNNING` is rejected (`BackupAlreadyInProgressError`); a `RUNNING` row stuck past `BACKUP_STALE_RUNNING_MINUTES` (default 120) is treated as abandoned (the owning process crashed) and automatically reaped to `FAILED`, unblocking future backups.
- **Real retention/cleanup** — on-disk artifacts for `SUCCEEDED` backups older than `BACKUP_RETENTION_DAYS` (default 14) are deleted, but the `BackupRun` row is kept (real audit history outlives the disk data it describes); a `BACKUP_MIN_RETAINED` floor (default 3) always keeps the most recent successful backups regardless of age.
- **Real observability** (`GET /admin/backups`) — `currentStatus` (`RUNNING`/`HEALTHY`/`UNHEALTHY`/`NO_BACKUPS_YET`), `lastSuccessful`, `lastFailed`, `backupAgeHours`, `consecutiveFailures`, and full run history, computed entirely from real `BackupRun` rows. `POST /admin/backups/trigger` for a real, synchronous manual backup — both gated by the same `requireSystemAdmin` boundary every other admin route already enforces.
- **4 new ops runbooks** (`docs/ops/BACKUP_RUNBOOK.md`, `RESTORE_RUNBOOK.md`, `DISASTER_RECOVERY_RUNBOOK.md`, `INCIDENT_RESPONSE.md`) and `docs/PHASE_31_DISASTER_RECOVERY_PRODUCTION_OPERATIONS_CERTIFICATION.md`.
- **17 new real-PostgreSQL integration tests** (`phase31-backup.integration.test.ts`) covering functional backup/restore, retention, 5 real failure-injection scenarios (concurrent invocation, interrupted/abandoned backup, unavailable destination, corrupted artifact, restore failure), scheduler duplicate-prevention/coalescing, real job-queue end-to-end execution, observability correctness, and admin-endpoint authorization.

### Fixed (real defects found while building this phase, not hypothetical)

- **A restore-breaking table-list bug**: the new backup's table list was computed directly against the real `public` schema (unlike Phase 30's rehearsal script, which reads its list from an already-migrated isolated schema) — this included `_prisma_migrations`, Prisma's own tooling table, which is never created by any `migration.sql` file. A restore into a freshly migration-replayed target schema failed outright. Fixed by explicitly excluding it from the dump's table list, with the reasoning documented inline.
- **A JSON/JSONB column double-serialization bug**: values round-tripped through the backup file as real JS objects/arrays; passed as bare parameters to a parameterized `INSERT`, the `pg` driver has no column-type context and serializes a JS array using Postgres ARRAY-LITERAL syntax, not JSON text — Postgres's own json/jsonb parser then rejected it. Fixed by explicitly re-stringifying `json`/`jsonb`-typed column values before binding, with an explicit `::json`/`::jsonb` cast.

Both were found via a real end-to-end smoke test (real backup → real integrity check → real restore into an isolated schema) before any test suite was written — exactly the "real execution, never inferred from code" discipline this project has followed since Phase 15.

### Verified (real execution, this phase)

- Real backup → real checksum self-verification → real restore into an isolated, migration-replayed schema, exact row-count parity, zero mismatches.
- Real corruption detection: tampering with a table file after a successful dump is caught by re-computed checksums, never silently accepted.
- Real concurrent-invocation rejection and real stale-run reaping (a `RUNNING` row 6 hours old is reaped to `FAILED`, unblocking a new attempt).
- Real scheduler coalescing: a schedule left overdue 4 real days fires exactly 1 backup Job, not 4.
- Real end-to-end job-queue execution: a `database-backup` Job enqueued and drained through the actual `runWorkerTick` path produces a real, linked `SUCCEEDED` BackupRun.
- Full regression: 102/102 backend unit tests, 326/327 real-PostgreSQL integration tests (the 1 failure is the same pre-existing scheduler-tick timing flake under full-suite concurrent DB load documented as a non-regression in Phase 30 — re-confirmed 7/7 clean in isolation this phase too), 0 backend lint/typecheck errors.

### Blocked / deferred / not re-attempted (honest, not fabricated)

- **Off-host/cloud backup storage** — `BLOCKED — CREDENTIAL`. `BACKUP_DIR` is local disk by design this phase; no real S3/GCS/off-host credential is configured in this environment. This is the single highest-priority follow-up before this system satisfies genuine disaster recovery (a single-host disk failure takes the backups with it otherwise) — stated plainly, not glossed over.
- **Docker image builds / container-based backup verification** — `BLOCKED — ENVIRONMENT`, unchanged from every prior phase; Docker Desktop is not reachable and not installed at its expected path in this session's environment.
- **PGlite as an integration-suite substitute** — not re-attempted this phase; Phase 30 already established (real execution, not assumption) that PGlite's socket bridge destabilizes under this app's pooled-connection concurrency pattern, and this phase's backup logic leans even more heavily on raw catalog (`pg_constraint`/`pg_class`) introspection than Phase 30's own rehearsal script did, so re-attempting would not have produced new information.

## [0.1.0-rc.14] — Phase 30: Production Launch Readiness & Reliability Certification

Fourteenth release candidate. Asked one question of the technically-certified Phase 29 platform: if a real first customer arrived tomorrow, would their account, data, workflows, billing state, and experience hold up? Hardened the *existing* system rather than building new features — closed real zero-coverage gaps in auth/session security and abuse protection, built the first systematic 7×6 authorization matrix, found and fixed a genuine concurrency defect in credit-ledger event tracking, ran the first complete all-50-table backup/restore certification with a real RTO measurement, closed an observability gap (error codes never reached structured logs), added the first customer-facing non-blank-screen error recovery, extended the dashboard to a real Today/Yesterday activity timeline, ran the first real concurrent-load test against a live server, and added the first evidence-based (not blind) database indexes.

### Added

- **Refresh-token-reuse and session-revocation test coverage** (`phase30-auth-hardening.integration.test.ts`, 6 tests) — real, working rotation/revocation logic in `auth.service.ts` had zero test coverage before this phase. Documents a real, bounded design tradeoff: a demoted OWNER's already-issued access token keeps stale permissions until its next refresh (≤`JWT_EXPIRES_IN`, default 15 min), not indefinitely.
- **First systematic authorization matrix** (`phase30-authorization-matrix.integration.test.ts`, 9 tests) — every cell of the real 7-permission × 6-role catalog (`seed-rbac.ts`) verified via a real HTTP request against the endpoint that gates it, plus `isSystemAdmin` platform-flag orthogonality and anonymous-rejection checks.
- **Abuse-protection coverage for feedback spam and adversarial pagination** (`phase30-abuse-protection.integration.test.ts`, 6 tests) — closes two previously-untested surfaces on top of Phase 26-29's existing login/register/invitation/workflow-spam protection.
- **9 new Stripe production/test-key guard tests** appended to `env.production-guard.test.ts` (now 28/28) — closed a real zero-coverage gap in `env.ts`'s `sk_test_`/`sk_live_` environment-mismatch rejection.
- **`errorCode` in structured access logs** — `error-handler.ts` now stashes the real error code on `res.locals.errorCode`; `request-logger.ts` reads it into every log line. Previously only the raw HTTP status was logged, making "find every real `AUTH_INVALID_CREDENTIALS` this hour" impossible without cross-referencing response bodies. 10 new tests (`phase30-observability.integration.test.ts`) prove structured logging, correlation-ID round-tripping (both auto-generated and caller-supplied), and secret-free logging all genuinely hold.
- **Customer-facing error recovery, never a blank screen**: `ErrorBoundary.tsx` now offers two distinct real recovery actions (Retry / Panelə qayıt), not one; Marketing Autopilot and Billing error states now explicitly reassure "Kreditləriniz itirilmədi" / "Abunəliyiniz dəyişdirilmədi" — each reassurance verified against the real underlying transactional guarantee before being written, not assumed.
- **Dashboard grouped activity timeline** — the existing flat "Son fəaliyyət" list is now grouped into real local-calendar-day buckets (Bugün / Dünən / DD.MM), each item showing its real time of day.
- **`ai_usages(createdAt)` and `workflow_instances(createdAt)` indexes** — the only 2 (of 35 audited, unindexed FK columns) actually justified by a real query pattern, confirmed via `EXPLAIN ANALYZE` against the admin dashboard's real cross-tenant 30-day aggregate query, which filters on `createdAt` alone (the existing composite indexes are `workspaceId`-first and cannot serve it). The other 33 are write-only audit-trail columns never used as a query filter anywhere in the codebase — deliberately NOT indexed, since an unjustified index only adds write overhead.
- **`docs/PHASE_30_ENVIRONMENT_CONFIG_AUDIT.md`, `docs/PHASE_30_SECURITY_CERTIFICATION.md`, `docs/PHASE_30_DISASTER_RECOVERY.md`, `docs/PHASE_30_PRODUCTION_HARDENING_CERTIFICATION.md`** — full Phase 30 certification record.

### Fixed

- **A genuine, reproducible concurrency race in `credit-ledger.service.ts`'s `FIRST_AI_ACTION` gated event** — the check-and-write used to happen *after* the charging transaction committed (and its row lock released), a real TOCTOU window. 20-way real concurrent `recordUsage()` calls against one brand-new workspace reproduced 2+ duplicate `FIRST_AI_ACTION` rows in 3/3 stress runs — confirmed only after an initial 2-way concurrency test passed (correctly recognized as insufficient evidence either way). Fixed by moving the check-and-write inside the same transaction, guarded by the same workspace row lock already held for the balance check, making it exactly-once for real. Re-verified: 20-way stress test 3/3 clean, full event-integrity suite 3/3, billing/credit regression 14/14, zero regressions elsewhere.
- **A real data-corruption risk in the backup/restore technique itself**: the row-cast restore approach `(t::text::schema.table).*` (used since Phase 29) silently assumes identical physical column order between two schema copies of a table — broken for any table whose columns were added across multiple migrations (found on `workspace_settings`). Rewrote the full 50-table restore to use explicit named-and-typed column selection for every table.
- **A fabricated 18-table FK cycle** from a naive `information_schema` join without a `table_name` qualifier, discovered while building the backup/restore script — the real graph (queried directly from `pg_constraint`) has exactly 3 genuine circular references, all nullable "current pointer" patterns, all correctly handled (insert NULL, fix up once both sides exist).
- **The production load test's error classification** conflated healthy `429` rate-limiting with genuine capacity failure — `POST /auth/register` at concurrency 25/50 initially looked like a 64%/100% failure rate. Root-caused to the real, working `authRateLimit` (20 req/15min/IP) via a direct diagnostic call confirming a genuine `RATE_LIMIT_EXCEEDED` response, not a 5xx. Fixed the script to report rate-limited and genuinely-failed requests as separate buckets.

### Verified (real execution, this phase)

- **Load test** — `GET /health/ready`: 0% genuine errors at concurrency 10/25/50/100 (p50 up to 408ms at 100 concurrent). `POST /auth/register`: 0% genuine errors at every concurrency level; only expected, healthy rate-limiting beyond the 20-request/15-min budget.
- **Backup/restore certification** — all 50 real tables, real FK-computed restore order (Kahn's algorithm against `pg_constraint`), exact row-count match, zero mismatches. Re-verified after this phase's own index migration: still 0 mismatches. First real RTO measurement (schema + data restore, current data volume). RPO honestly reported as unmeasured (no automated backup schedule yet — a real, stated Phase 29 decision) with a recommended ≤24h target.
- **Migration forward/rollback rehearsal** (real substitute for a full container-based zero-downtime rehearsal — Docker's daemon was unreachable this session) — this phase's own `ai_usages`/`workflow_instances` index migration proven additive-only, safely rolled back (`DROP INDEX`) and forward again against the live dev database with the real admin-aggregate query continuing to function throughout.
- **Full regression**: 102/102 backend unit tests, 313/313 real-PostgreSQL integration tests across the 3 suite runs performed this phase (1 scheduler end-to-end test flaked once under full-suite concurrent DB load, confirmed non-regression via 7/7 clean in isolation), 12/12 Playwright E2E, 0 backend/frontend lint errors, 0 backend/frontend typecheck errors.

### Blocked / deferred (honest, not fabricated)

- **Docker image builds and container-based deployment rehearsal** (`bizpilot-backend/frontend/scheduler:phase30`) — `BLOCKED — ENVIRONMENT`. Docker Desktop is not reachable and not installed at its expected path in this session's environment; substituted with the real migration forward/rollback rehearsal above where possible.
- **PGlite as a full concurrency-critical integration-suite substitute** — `DEFERRED`, real finding: the PGlite socket-bridge server (`db:dev:pglite`) genuinely destabilizes and drops connections (`ECONNRESET`) under this app's Prisma-pooled concurrent connection pattern, even after this phase's own migration replayed cleanly against it (337 statements, 0 errors). Confirms this project's own existing architectural note that PGlite is "the documented, correct choice for MVP single-instance operation," not a substitute for concurrency-critical certification — real PostgreSQL (313/313 passing) remains authoritative, per this project's stated preference.
- **Stripe/OpenAI real-provider evidence** — `BLOCKED — CREDENTIAL`, unchanged from every prior phase; mock providers are never presented as real ones.

## [0.1.0-rc.13] — Phase 29: Production Growth, Reliability & Customer Intelligence

Thirteenth release candidate. Turned the technically-certified Phase 28 platform toward acquiring, onboarding, retaining, and learning from its first real customers: a first-party product-analytics foundation, activation metrics with honest small-sample handling, admin product intelligence, real workflow failure recovery, a customer feedback channel, a top-level frontend error boundary, and closed data-integrity gaps found via live execution — not just code review.

### Added

- **`ProductEvent` model + tracking service** (`analytics/product-event.service.ts`) — 24-event vocabulary across acquisition/onboarding/activation/engagement/commercial/retention, wired into 12 real backend call sites (registration, workspace creation, onboarding completion, workflow lifecycle, first AI action, content generation/approval, subscription changes). A server-side allowlist (`CLIENT_TRACKABLE_EVENTS`) means the client-facing `POST /workspaces/:id/events` endpoint can never spoof a business-critical event.
- **Activation metrics engine** (`activation-metrics.service.ts`) — signup conversion, onboarding completion, time-to-first-value, 7-day return rate, first-AI-action/workflow/content rates. Every metric is classified `OBSERVED`/`INSUFFICIENT_SAMPLE`/`NO_DATA` (`MIN_SAMPLE_SIZE = 10`, a documented MVP choice) — never a misleading percentage from a handful of users.
- **Dashboard "Son fəaliyyət" (recent activity) widget** — a real, tenant-scoped read of the most recent business-meaningful `ProductEvent` rows (`GET /workspaces/:id/events/activity`), not the previously-unused `Activity` table (avoided building a second, parallel event-recording pathway for the same moments).
- **Admin product intelligence** — ~15 new dashboard metrics (users/workspaces/AI/workflows/billing), explicitly using `activeSubscriptionCatalogValueCents` rather than "MRR" (the spec's own instruction: never label a metric MRR unless the billing data actually supports that definition).
- **Dead-letter job admin operations** — list/retry/cancel (`admin/jobs/*`), RBAC-protected, atomic conditional-transition claims (the same real-Postgres-row-guarantee pattern used throughout this project since Phase 25), fully audited.
- **Real workflow failure recovery** (`POST /workflow-instances/:id/retry`) — FAILED → RETRYING → RUNNING → COMPLETED, with a full audit trail (who/why/previous-state/new-state).
- **Feedback channel** — `Feedback` model, `POST/GET /workspaces/:id/feedback` (customer-facing), `GET /admin/feedback` + `PATCH /admin/feedback/:id/status` (cross-tenant admin triage), `/feedback` frontend page + nav item.
- **3 previously-dead `NotificationType` values wired to real call sites**: `WORKFLOW_RETRYING`, `PAYMENT_FAILED` (real Stripe `invoice.payment_failed` handling), `SCHEDULED_WORKFLOW_COMPLETED`.
- **Frontend top-level `ErrorBoundary`** — a React render crash now shows one recoverable Azerbaijani-language screen, never a blank page or an exposed stack trace; the real error is logged to the console for developers only. Live-verified with a synthetic crash injected and removed during this session.
- `docs/PHASE_29_DATA_RETENTION_POLICY.md` — a real classification of every unbounded-growth table (must-keep-indefinitely vs. safe-to-retention-limit), with automated enforcement deliberately deferred (not silently skipped) until a real backup/restore-verified deletion job can be built against real usage volume.
- `backend/src/scripts/perf-phase29.ts` — real p50/p95/p99 for this phase's new operations; workflow-start timing honestly labeled as including MOCK PROVIDER LATENCY (`AI_PROVIDER=mock`, no real OpenAI credential in this environment).
- `backend/src/scripts/backup-restore-rehearsal-phase29.ts` — a real backup/restore rehearsal substituting Phase 28's Docker-based `pg_dump`/`psql` method (Docker daemon unreachable this session, no native `pg_dump`/`psql` on this machine): full schema DDL replay from the real migration files into an isolated schema in the real dev database, representative 7-table data restore via SQL, exact row-count **and** content-hash verification, then clean teardown.

### Fixed

- **`WorkflowStepRun` unique-constraint collision on retry** — a genuine, previously-latent production defect: retrying a real FAILED instance always restarted its internal attempt counter at 1, colliding with the original failed run's own row. Found by this phase's own new retry integration test, not by inspection. Fixed by computing the real next `attempt` value from the existing max for that step.
- **Onboarding never reached `COMPLETED`** — the backend recognized steps up to `first_workflow_run` but nothing ever advanced it to `completed`; closed by chaining `advanceOnboardingStep(..., 'completed', ...)` after a real workflow completes, rather than building unnecessary new UI for intermediate steps with no distinct product moment for this MVP's target persona.
- **Credit-lifecycle threshold mismatch** — the frontend's low-credit visual states used different percentage thresholds than the backend's real `usage-alert.service.ts` (10%/30%-remaining vs. the backend's 80/90/100%-used); the frontend now mirrors the real backend thresholds exactly.
- **Azerbaijani month names not rendering in the dashboard activity feed** (`toLocaleString('az-AZ', {month:'short'})` produced a raw `"M08"` token — an observed browser-ICU-data gap, not a typo) — replaced with an explicit `DD.MM HH:mm` format that doesn't depend on locale month-name data.

### Security & regression

- New cross-tenant/RBAC/forged-ownership tests for every new resource this phase introduced: `jobId` (dead-letter admin actions), `feedbackId` (workspace + admin surfaces), `productEvent` (client allowlist spoofing, cross-tenant read/write).
- Fresh full regression this phase: **93/93 unit tests**, **275/275 real-Postgres integration tests (45/45 files)**, all Phase 29 migrations replay cleanly against PGlite, 0 lint errors, 0 typecheck errors, **12/12 Playwright E2E** (the golden-path suite now also asserts a real notification was received and the dashboard shows real activity after the workflow completes).
- One `scheduler-tick.integration.test.ts` failure observed under full-suite load, reproduced clean in isolation and on a full re-run — documented as suite-level flakiness (matching this same file's own prior documented PGlite-timing sensitivity), not a regression.

### Known limitations

- `DOCKER_REBUILD = BLOCKED — ENVIRONMENT` (this session only) — the Docker daemon could not be reached even after an explicit `docker desktop start` attempt; Phase 27/28's container-level certification is unchanged and not re-claimed as re-verified this phase. The E2E customer-journey proof (the other half of this phase's Docker+E2E task) is fully verified against the real dev server stack instead.
- `REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL` / `REAL_AI_PROVIDER = BLOCKED — CREDENTIAL` — unchanged since Phase 28/20 respectively.
- `DATA_RETENTION_ENFORCEMENT = DEFERRED` — a real, documented policy exists; automated deletion is deliberately not built yet (see the retention policy doc's own reasoning).

## [0.1.0-rc.12] — Phase 28: Production Automation & Payments

Twelfth release candidate. Turned the platform's job-queue machinery (Phase 27) into a real production scheduler for recurring workflows (Track A), and built Stripe payments behind the existing `BillingProvider` abstraction (Track B, TEST MODE only, isolated from every domain service). Real Docker container execution — not tests — surfaced two genuine, previously-undiscovered defects that would have caused every scheduled workflow to silently fail forever in production while reporting success.

### Fixed

- **Scheduled workflows silently stuck at `PENDING` forever, in the real standalone scheduler process.** `run-scheduler.ts` never imported the module that registers the Workflow Engine's step handlers (a side-effect import pattern `marketing-autopilot.routes.ts` already used) — every real execution threw `No step handlers registered ...` and, because of the next bug, a retry silently reported `SUCCEEDED` without the workflow ever advancing. Found via a real Docker container run (masked in every test by Vitest's shared module graph). Fixed by adding the missing import. (`backend/src/scripts/run-scheduler.ts`)
- **A masking idempotency bug in the Workflow Engine.** `startWorkflow`'s idempotency short-circuit returned a stuck-`PENDING` instance as-is on retry instead of resuming it. Fixed by resuming `PENDING` instances through `runToNextGate`, narrowly scoped (never `RUNNING`/`RETRYING`/`AWAITING_APPROVAL`). (`backend/src/modules/workflows/workflow-engine.service.ts`)
- **A real concurrency race**, found via the *full* integration suite (invisible when running scoped test files) while verifying the fix above: two concurrent callers could both pass an unconditional `PENDING → RUNNING` check and both execute the same instance's step loop, colliding on `WorkflowStepRun`'s unique constraint. Fixed by moving the real atomic claim into `runToNextGate` itself as the one choke point every caller passes through — verified deterministic across 2 full 251-test real-Postgres runs. (`backend/src/modules/workflows/workflow-engine.service.ts`)
- A Docker packaging gap: a bare `docker run --entrypoint` on the shared backend image inherits its HTTP-based `HEALTHCHECK`, wrong for the non-HTTP scheduler process — fixed with an explicit `--health-cmd` override, documented in the certification report.
- A real Docker Desktop environment defect (a broken `dockerInference` Unix-socket file blocking every `docker` command) and a Git-Bash path-mangling defect (`--build-arg`/`-e` values starting with `/` silently rewritten to Windows paths) — both found, root-caused, and worked around; both documented rather than silently fixed-and-forgotten.

### Added

**Track A — Production Scheduler:**
- `ScheduledWorkflow` model + `scheduled-workflow.service.ts`/`.controller.ts`/`.routes.ts` — `MINUTE/HOUR/DAY/WEEK/MONTH` recurring schedules, server-validated, DST-safe next-run computation via `luxon`.
- `scheduler-tick.service.ts` — the real scheduler tick, CAS-based duplicate prevention (MANDATORY requirement, proven via 5 real concurrent ticks × 3 repetitions, and re-proven via a real `docker restart`), missed-occurrence coalescing (864 missed → 1 real run).
- `run-scheduler.ts` — the real, invokable scheduler+worker process (`--once` for cron/tests, else an infinite tick loop); wired into `docker-compose.prod.yml` as a new `scheduler` service.

**Track B — Stripe Payments:**
- `stripe-billing-provider.ts` — `StripeBillingProvider implements BillingProvider`, TEST MODE only, no Stripe-specific type leaks past this file.
- `env.ts` — `PAYMENT_PROVIDER`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PUBLISHABLE_KEY` with fail-fast startup validation (required-when-stripe, key-prefix format, test/live-key/environment mismatch guards), mirroring the existing `AI_PROVIDER` pattern.
- `webhook.routes.ts` — the real `POST /api/v1/webhooks/stripe` HTTP endpoint (raw-body, mounted before the global JSON parser), plus `resolveWorkspaceId()`'s real `BillingCustomer`-based resolution (a real Stripe payload has no `workspaceId` field — Stripe's own `customer` id is the only trustworthy signal).

**Security & Docker:**
- `phase28-security-regression.integration.test.ts` — real cross-tenant webhook effect isolation between two known customers, and a real, executed secret-leakage scan (captured `console.log`/`console.error` output during a real scheduler tick and real webhook processing).
- `e2e/phase28-scheduler-container.spec.ts` (new, permanent) — 4 Playwright scenarios against real production containers: creation/validation, cross-tenant isolation, real execution, real restart recovery.
- `backend/src/scripts/perf-phase28.ts` — real p50/p95/p99 for all 7 required operations (scheduler tick, job creation/claim, full chain, webhook processing, subscription mutation, entitlement lookup).
- `docs/PHASE_28_PRODUCTION_AUTOMATION_PAYMENTS_CERTIFICATION.md` — full evidence report with a 38-gate matrix.

### Known limitations (unchanged categories, narrowed content)

- `REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL` (new this phase) — no real Stripe test-mode credential; every live-network Stripe code path (checkout, subscription create/upgrade/downgrade/cancel, invoice sync) is real, structurally complete, and honestly unexercised against a live account. The webhook-receiving half needs no live credential and is fully verified with real Stripe SDK cryptography.
- `REAL_AI_PROVIDER = BLOCKED — CREDENTIAL` — unchanged since Phase 20.
- No frontend checkout UI yet — Track A/B were API-only this phase, per scope.

### Test counts: 9/9 unit (88/88 tests), **39/39 integration files (251/251 tests) on real PostgreSQL**, 39/39 files (240/251 + 11 documented skips) on PGlite, **12/12 Playwright E2E (dev server) + 4/4 (real containers)**, 4/4 new security regression tests.

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** — 32 of 38 gates VERIFIED via real execution (including real Docker container execution that found and fixed 2 genuine production defects), 4 BLOCKED — CREDENTIAL (2 new: payment provider; 2 unchanged: AI provider + its live-network dependents), 2 NOT ATTEMPTED (honestly scoped: real Stripe invoice sync, soak testing), 0 FAILED.

## [0.1.0-rc.11] — Phase 27: Customer Experience, Operations & Production Readiness

Eleventh release candidate. Closed the gap between "the backend machinery exists" (Phase 26) and "a real customer and a real platform operator can use it end to end": built the generic, lease-based production job queue Phase 26 was missing (claim/retry-with-backoff/dead-letter, proven safe under real concurrent claims), hardened onboarding into an explicit NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED state machine, and — for the first time — built the notification center and admin control plane **frontends** (Phase 26 shipped only their backend APIs), both verified live in a real browser against the real backend.

### Fixed

- **A real, previously-undiscovered billing-integrity defect.** `recordUsage`'s `BLOCKED_BY_CREDIT_LIMIT` observability row was created inside the same Prisma transaction that then threw `InsufficientCreditsError` — Prisma rolled back the entire transaction on that throw, silently discarding the very row the error message claimed was logged ("Usage attempt logged as `${usage.id}`" was a false promise). Found via a real end-to-end customer-lifecycle test. Fixed by committing the transaction before throwing, preserving the real-time balance-check atomicity under concurrency while making the observability record genuinely durable. Re-verified across the full billing/workflow regression (117/117) on both databases. (`backend/src/modules/billing/credit-ledger.service.ts`)
- Three test-authoring bugs found and fixed via real execution feedback (not application defects): a wrong-token bug that masked an intended 404 assertion behind an unrelated 401; a burst-test ordering issue against the shared IP-keyed auth rate limiter; a FREE-plan seat-limit confound in an invitation-spam test.

### Added

- `job-queue.service.ts` — general-purpose production job queue (`Job`/`JobStatus`), additive to Phase 26's proven credit-grant scheduler, wired to one real piece of business logic (`credit-grant-sweep`) so it's proven against genuine work.
- Onboarding: `Settings.onboardingStatus` (NOT_STARTED/IN_PROGRESS/COMPLETED/SKIPPED), a new top-level `GET /onboarding/status` for the pre-workspace NOT_STARTED state, and `skipOnboarding`.
- Notification center **frontend**: header bell with a live unread badge, dropdown preview, mark-read/mark-all-read, and a full paginated notifications page — the first frontend built for Phase 26's notification API.
- Admin control plane **frontend**: live dashboard metrics (users/workspaces/subscriptions/AI-usage/credits/workflow executions), searchable user and workspace tables — the first frontend built for Phase 26's admin API. `isSystemAdmin` added to the sanitized user object (UX-only — every admin route still independently re-verifies server-side).
- `abuse-protection.integration.test.ts` — oversized-payload 413, invitation-spam 429, zero-credit concurrent spam, login/registration burst.
- `health.integration.test.ts` — the first real HTTP tests for `/health/live` and `/health/ready` (existed since Phase 16, never directly tested); readiness now reports `database` and `jobQueue` as two independent fields.
- 3 new Playwright E2E scenarios for the new frontend surfaces (9 → 12, all passing).
- Real DB-unavailable failure injection: a throwaway container with a deliberately unreachable database proved liveness stays 200 while readiness correctly returns 503 with `database: unreachable`.
- Real backup/restore rehearsal repeated for the two new tables this phase introduced (`jobs`, `workspace_settings.onboardingStatus`) — exact row-count parity, zero production impact.
- `docs/PHASE_27_CUSTOMER_EXPERIENCE_PRODUCTION_READINESS_CERTIFICATION.md` — full evidence report with a 27-gate matrix.

### Two new PGlite-vs-real-PostgreSQL divergences

A job-queue concurrent-claim race (same category as three prior divergences) and a newly-discovered `DateTime` timezone-shift-on-round-trip bug in the PGlite adapter — directly reproduced and root-caused (writing `new Date()` and reading it back returned a value offset by exactly this environment's local UTC offset). Both gated to real-Postgres-only, per this phase's own rule that PGlite must never be faked as passing.

### Known limitations (unchanged)

- `REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL` — no real Stripe credential; unchanged from Phase 25/26.
- No live scheduler daemon — the job-queue and credit-grant logic are concurrency-safe and correct, but nothing in this environment triggers either on a real recurring schedule.

### Test counts: 60/60 unit, **221/221 integration (real PostgreSQL)**, 216/221 + 5 skipped (PGlite, all documented limitations), **12/12 Playwright E2E**, 39/39 security/tenant-isolation regression.

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** — 21 of 27 gates VERIFIED via real execution, 1 BLOCKED — CREDENTIAL (payment provider, unchanged), 2 NOT ATTEMPTED (honestly scoped), 2 SKIPPED — INFRASTRUCTURE LIMITATION (documented PGlite divergences), 1 real defect found and fixed, 0 FAILED.

## [0.1.0-rc.10] — Phase 26: Production-Grade SaaS Operations, Onboarding & Admin Control Plane

Tenth release candidate. Built the operational machinery a real SaaS company needs to hand the product to its first paying customers: a notification system (14 event types, idempotent creation via a real Postgres unique constraint), an admin control plane with server-authoritative authorization (`isSystemAdmin` resolved only from the verified JWT, never client input — proven orthogonal to workspace roles by testing that even a workspace OWNER token gets 403 on admin routes), a monthly credit-grant scheduler closing Phase 25's documented "no scheduler exists" gap (mandatory invariant: 10 real concurrent job executions for the same workspace+period produce exactly one grant, database-enforced via a `ScheduledJobRun` unique constraint), a usage-alert engine (80/90/100% thresholds, concurrency-safe), and backend-authoritative onboarding/activation tracking (`Activated Customer = workspace created + first workflow created + first successful AI operation`, computed live from real usage data every request, never a client-settable flag).

### Fixed

- **A real test-suite defect, found via a real PGlite regression run**: gating the scheduler's MANDATORY concurrency test to skip under PGlite (see "PGlite divergence" below) broke the very next test in the same file, which implicitly depended on the skipped test's side effect of leaving a `SUCCEEDED` job row behind on a shared `workspace` variable — surfaced as a genuine test failure (169/173 passed, 1 failed) rather than silently passing for the wrong reason. Fixed by making the dependent test fully self-contained with its own fresh user/workspace and an explicit two-call sequence, re-verified clean on both real Postgres (6/6) and PGlite (5/5 + 1 skip) afterward. (`backend/src/modules/billing/scheduler.integration.test.ts`)

### Added

- Notification system: `notification.service.ts`/`.controller.ts`/`.routes.ts`, top-level `/notifications` (deliberately not workspace-path-scoped — the real authorization boundary is always `recipientUserId`), wired into registration, subscription changes, invitations, workflow completion, and usage alerts.
- `scheduler.service.ts` — real, database-enforced exactly-once monthly credit-grant scheduling, plus a working (but not live-cron-wired — see Known limitations) CLI entry point.
- `usage-alert.service.ts` — configurable 80/90/100% usage-threshold notifications, concurrency-tested (8-way).
- Admin control plane: `admin.service.ts`/`.controller.ts`/`.routes.ts`, `requireSystemAdmin` middleware, top-level `/admin` — workspace search/inspect/audit-log, and one real mutating action (`adjustWorkspaceCredits`, audited).
- Onboarding/activation: `onboarding.service.ts`/`.controller.ts`/`.routes.ts`, workspace-scoped `/workspaces/:id/onboarding` — resumable, forward-only progression plus a live-computed activation status.
- New rate limiters: `invitationRateLimit` (30/hour), `adminRateLimit` (200/15min), `notificationRateLimit` (60/min) — the notification limiter verified under a real 65-request burst producing genuine 429s.
- Schema: `Notification.type` + `NotificationType` enum (14 values) with a `@@unique([workspaceId, type, relatedEntityId])` idempotency constraint; new `ScheduledJobRun` model + `JobRunStatus` enum; `Settings.onboardingStep`/`onboardingCompletedAt`. Applied via a real migration (`prisma migrate deploy`, the same shadow-DB-free workaround used every phase since `bizpilot_app` lacks `CREATEDB`).
- 40 new integration tests across notifications, scheduler, usage alerts, admin, onboarding, onboarding-security/tenant-isolation, error-taxonomy, and real performance measurement (181 → real Postgres total).
- Real backup/restore rehearsal: `pg_dump`/`psql` into an isolated `restore_verify` schema (the app role lacks `CREATEDB` but has `CREATE SCHEMA`), verified via direct row/index/constraint comparison, cleaned up with zero impact on live data (`public.users` count unchanged: 236 before and after).
- `docs/PHASE_26_PRODUCTION_SAAS_OPERATIONS_CERTIFICATION.md` — full evidence report with a 21-gate matrix.

### A third confirmed PGlite-vs-real-Postgres divergence

The scheduler's MANDATORY "10 concurrent jobs → exactly 1 grant" test passes deterministically on real PostgreSQL (3/3 repeated runs) and fails deterministically on PGlite (3/3 repeated runs, `grantedCount` received as `0`) — a different failure shape than the two divergences found in Phase 25, same root cause (PGlite's single-connection in-process engine does not replicate real Postgres's concurrent-transaction unique-constraint arbitration). Gated to real-Postgres-only, per the established pattern.

### Known limitations (new this phase, honestly scoped out rather than fabricated)

- No live cron/scheduled trigger exists in this environment for the credit-grant job — the job logic is proven concurrency-safe against real Postgres, but nothing currently invokes it on an actual monthly cadence.
- No production onboarding frontend wizard was built — only backend APIs.
- No new Playwright E2E scenarios were added (existing 9/9 suite re-confirmed unchanged, since no new frontend UI exists yet to script against).
- No dedicated new Playwright run against the Phase 26 Docker containers specifically (verified via curl/HTTP smoke tests instead).
- `REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL` — unchanged, carried forward from Phase 25.

### Test counts: 60/60 unit, **181/181 integration (real PostgreSQL)**, 178/181 + 3 skipped (PGlite, all documented limitations), 9/9 Playwright E2E (unchanged, re-confirmed not broken).

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** — 16 of 21 gates VERIFIED via real execution, 1 BLOCKED — CREDENTIAL (payment provider, unchanged), 4 NOT ATTEMPTED (honestly scoped out), 0 FAILED.

## [0.1.0-rc.9] — Phase 25: Commercial SaaS Productization & Monetization Certification

Ninth release candidate. Discovered that the full commercial domain model (`SubscriptionPlan`, `Subscription`, `Payment`, `Invoice`, `InvoiceItem`, `TeamInvite`, `Role`/`Permission`, `FeatureFlag`, `AuditLog`) already existed in the Prisma schema from earlier architecture phases but had zero application code wired to it — every workspace previously got a flat, plan-independent 100-credit grant and no `Subscription` row at all. This phase wired real services, a real API surface, and a real frontend onto that existing schema, adding only two genuinely new models (`BillingCustomer`, `WebhookEvent`) via a real migration.

### Added

- Entitlement engine (single authoritative layer for plan-limit checks), subscription state machine with a real audit trail (one real illegal-transition bug found and fixed), trial engine (account-scoped eligibility), team/invitation management with Postgres-safe concurrent-seat-limit enforcement, a provider-neutral billing abstraction with a deterministic `MockBillingProvider`, idempotent webhook processing (a genuine concurrent-delivery race made to happen and recover correctly), the invoice domain (integer cents throughout), and a real frontend billing/usage dashboard plus team management page — verified live in a browser, where one real UX bug (misleading AI-credits usage-bar) was found and fixed.
- 55 new integration tests (76 → 131 against real Postgres).
- `docs/PHASE_25_COMMERCIAL_SAAS_CERTIFICATION.md`.

### A second confirmed PGlite-vs-real-Postgres divergence

Two of the 55 new tests (a seat-race and a timestamp-rollover scenario) are deterministically correct against real Postgres (3/3 repeated runs) and deterministically fail against PGlite (3/3 repeated runs) for reasons unrelated to application logic — both gated to run only against real Postgres, with reasoning documented inline.

### Known limitations (unchanged)

- `REAL_PAYMENT_PROVIDER = BLOCKED — CREDENTIAL` — no real Stripe/PayPal credential exists; `MockBillingProvider` is the only implementation, correctly not claimed as more.

### Test counts: 60/60 unit, **131/131 integration (real PostgreSQL)**, 129/131 + 2 skipped (PGlite), 9/9 Playwright E2E.

### Release verdict: **RELEASE CANDIDATE — PAYMENT PROVIDER BLOCKER** — 19 of 22 gates VERIFIED via real execution, 1 BLOCKED — CREDENTIAL, 2 NOT ATTEMPTED (honestly scoped out), 0 FAILED.

## [0.1.0-rc.8] — Phase 24: AI Platform Hardening, Billing Integrity & Provider Readiness Certification

Eighth release candidate. Audited the complete AI request pipeline end to end and found one real, previously-undiscovered billing-integrity defect: AI-bearing workflow steps deducted credits *before* calling the provider, and the workflow engine retries a failed step's entire handler (including the credit deduction) up to 3 times — so a transient provider failure that eventually succeeded, or one that exhausted retries, could charge a workspace 2-3x for one logical action.

### Fixed

- **Exactly-once AI billing defect.** Split the credit-ledger into a read-only pre-flight check (before the provider call) and a charge that only happens after a successful, validated response. Proven correct by a real concurrent-request race made to happen and recover correctly, both in integration tests and inside a freshly-built real Docker container. (`backend/src/modules/workflows/*`, billing/credit-ledger modules)
- **Raw third-party SDK error text relayed into a client-facing error message** (OpenAI adapter). Now logged server-side only; the client receives a generic message. (`backend/src/infrastructure/openai/openai.adapter.ts`)

### Added

- 20 new tests across input validation, exactly-once billing, tenant isolation, rate limiting, and local performance measurement.
- `docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md`, `docs/PHASE_24_AI_PLATFORM_CERTIFICATION.md`.

### Known limitations (unchanged)

- `REAL_AI_PROVIDER = BLOCKED — CREDENTIAL` — no `OPENAI_API_KEY` exists anywhere in this session (confirmed via `env`, PowerShell environment enumeration, full git history scan, and source-tree scan — all clean).

### Test counts: 60/60 unit (up from 48), **76/76 integration (real PostgreSQL)**, 76/76 (PGlite), 9/9 Playwright E2E.

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** (unchanged category — every gate not requiring a live AI-provider credential is VERIFIED via real execution).

## [0.1.0-rc.7] — Phase 23 (continued): Real Docker Containerization Certification

Seventh release candidate — the phase that actually ran BizPilot.Ai inside real Docker containers, once Docker became reachable from this session's execution environment mid-phase. Real `docker build` executions immediately surfaced 4 genuine, previously-undiscovered build/runtime defects that no amount of structural review had caught; running the actual containers surfaced 2 more. All 6 were found and fixed, then re-verified through the complete real-container certification: golden path, concurrent-approval safety, tenant isolation, the full 9-test Playwright suite (against the real production containers, not dev servers, for the first time ever), a restart/persistence cycle, failure injection, a stability soak test, and a full rollback rehearsal.

### Fixed

- **Backend production image would not build.** `backend/Dockerfile` copied a non-existent `backend/node_modules` path (npm workspace hoisting makes this directory not exist for a single-workspace install). (`backend/Dockerfile`)
- **Backend production image would not build (second defect, same build).** `tsc` ran before `prisma generate`, so generated Prisma model types (`WorkflowInstance`, `Prisma.InputJsonValue`, etc.) didn't exist yet, producing dozens of "has no exported member" errors. Reordered the two `RUN` lines. (`backend/Dockerfile`)
- **Both production images would not build.** Neither Dockerfile copied `tsconfig.base.json` into the build context — `backend/tsconfig.json` and `frontend/tsconfig*.json` both `extend` it, and TypeScript silently falls back to compiler defaults (dropping `strict`/`esModuleInterop`/`skipLibCheck`) rather than erroring on a missing extends target, producing a wide, misleading spread of unrelated-looking type errors across every third-party package's own ambient `.d.ts` files. (`backend/Dockerfile`, `frontend/Dockerfile`)
- **The production backend container crashed on every single startup, regardless of configuration.** `backend/src/infrastructure/database/prisma.ts` statically imported `./pglite-adapter`, which requires `@electric-sql/pglite` — a devDependency intentionally absent from the production image. Node tried to `require()` it at process startup regardless of `USE_PGLITE_ADAPTER`'s value. A first fix (a guarded top-level `require()`) solved production but broke the PGlite integration-test path (Vitest's ESM transform intercepts `import()`, not raw `require()`) — caught by re-running the full test suite before declaring the fix complete. The actual fix defers the import into `connect()`/`connectToShadowDb()` via dynamic `import()`, which both Node and Vite/Vitest resolve correctly, and which is never even attempted unless a query genuinely executes with the flag on. (`backend/src/infrastructure/database/prisma.ts`)
- **Nginx was sending duplicate, conflicting security headers on every proxied API response.** `frontend/nginx.conf.template`'s server-level `add_header` directives stacked on top of the backend's own Helmet-set headers rather than overriding them — found via a real `curl -v` showing two `X-Frame-Options` headers (`SAMEORIGIN` then `DENY`), two `Referrer-Policy` headers, two `X-XSS-Protection` headers. Moved the headers into `location /` and `location /assets/` specifically, so `location /api/` (which has none of its own) never inherits them and the backend's headers pass through untouched. (`frontend/nginx.conf.template`)
- **Every API call from the production frontend failed completely silently, with zero network activity.** The frontend Docker build's `--build-arg VITE_API_BASE_URL=/api/v1`, run from this session's Git-Bash shell, was silently mangled by MSYS's automatic POSIX-path conversion into a Windows path fragment baked permanently into the minified JS bundle (Vite inlines build args at build time). Found via live browser debugging: a raw in-page `fetch()` succeeded perfectly (ruling out CORS/nginx/network), while the app's own axios-based call never even attempted a request; confirmed by grepping the compiled bundle. This is the same class of environment artifact found in Phase 22 (`API_PREFIX`) — now recognized as a systemic risk whenever a value that looks like an absolute POSIX path is passed to a Docker command from this shell. Fixed by rebuilding with `MSYS_NO_PATHCONV=1`. No code change was needed — this was purely a local build-environment artifact.

### Added

- Full container-level certification evidence in `docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md`: real Docker runtime info, real image builds and inspection, real container startup against the existing real PostgreSQL (via `host.docker.internal`, explicitly not the compose-bundled fresh database), the first real database query from inside a container, the full core business flow and concurrent-approval race proven through real containers, real cross-tenant isolation probes, the first-ever Playwright E2E run (9/9) against the actual production containers rather than dev servers, a real restart/persistence cycle, real failure injection, a real 400-request stability soak test, and a full rollback rehearsal (bad-candidate deploy → detected via `/health/ready` → rolled back → verified recovered).

### Known limitations (unchanged)

- `REAL_AI_PROVIDER = BLOCKED — CREDENTIAL` — no `OPENAI_API_KEY`; mock remains the deliberate, architecturally-supported default. This is the one remaining gate this project has never closed, and it is not a Docker/engineering blocker.

### Test counts: 48/48 unit, 49/49 integration (real PostgreSQL), **9/9 Playwright E2E against the real production Docker containers** (a first).

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** (unchanged category — every engineering gate this project's Definition of Done lists is now VERIFIED via real execution; only the AI-provider credential remains outstanding, a business decision rather than an engineering one).

## [0.1.0-rc.6] — Phase 23: Production Deployment & Launch Certification

Sixth release candidate. Phase 23's primary objective — containerize and certify BizPilot.Ai inside real Docker images — remains **BLOCKED — ENVIRONMENT**: Docker was not installed in this environment at any point this phase, re-checked three times. What this phase achieved instead: a real, structural review of the existing Docker artifacts found and fixed a defect that would have crashed the production backend image on its first database query, hardened the frontend's Nginx config, authored a genuine production `docker-compose` topology (none existed before), extended CI with a real Docker build + container smoke test job, closed two production-config validation gaps, and ran a real, clean stability soak test against the real PostgreSQL server certified in Phase 22.

### Fixed

- **The production backend Docker image would have crashed on its first real database query.** `backend/Dockerfile`'s `prune` stage (`npm ci --omit=dev`) never regenerates the Prisma client — no `prisma` CLI available in that install, no `postinstall` hook — and the `build` stage's correctly-generated client was never copied into the final runtime image. Found by structural review of the Dockerfile's stage graph (Docker itself was unavailable to actually build and run it); fixed by copying the already-correct generated client from the `build` stage. (`backend/Dockerfile`)
- **`DATABASE_URL` format was never validated.** A malformed connection string (not even a `postgresql://` URL) previously passed schema validation and only failed deep inside Prisma's own connection attempt. Added a regex format check. (`backend/src/config/env.ts`)
- **`AI_PROVIDER=openai` with no `OPENAI_API_KEY` wasn't caught at startup.** Previously only failed inside `OpenAIAdapter`'s constructor — a worse failure mode, deep in a request path rather than at boot. Added a `superRefine` check. (`backend/src/config/env.ts`)

### Added

- `docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md` — full evidence report distinguishing process-level verification (real, done) from container-level verification (blocked on Docker).
- `docker-compose.prod.yml` — the first real production deployment topology (backend + frontend/nginx + PostgreSQL, wired per this phase's architecture diagram), not yet runtime-verified.
- `frontend/nginx.conf.template` (renamed from `nginx.conf`): real security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `X-XSS-Protection`, `Permissions-Policy`) and a `/api` reverse-proxy block via envsubst templating (`${BACKEND_UPSTREAM}`), neither of which existed before.
- `.github/workflows/ci.yml`: a new `docker-build` job — builds both images, runs real migrations against a GitHub Actions Postgres service container, starts the backend container, and smoke-tests health + register via curl. Expected to actually execute on a real GitHub Actions runner (which ships Docker natively) even though it could not be executed locally.
- `.dockerignore` hardened: added `.env.*`, `backups/`, `*.dump`, `*.pem`, `*.key`.
- 7 new unit tests (`env.production-guard.test.ts`, 12 → 19): missing-mandatory-variable and malformed-`DATABASE_URL` scenarios, both branches of the `AI_PROVIDER=openai` key requirement.
- A real, clean soak test against the real PostgreSQL server: 400 requests over one authenticated session, 0 non-200 responses, 0 memory growth (67.21MB → 67.21MB), 0 database-connection leak (1 pooled connection throughout). A real finding along the way: repeating `/auth/login` in a soak loop correctly triggers `authRateLimit`'s 20-per-15-minute IP-keyed cap (shared across register/login/refresh) — the rate limiter working as designed, not a stability defect.

### Known limitations (changed from Phase 22)

- Docker remains unavailable in this environment — `DOCKER_BUILD`, `DOCKER_RUNTIME`, containerized `PRODUCTION_E2E`, and `ROLLBACK` (which requires a deployed container to roll back) all remain BLOCKED — ENVIRONMENT, not defects.
- No real AI provider credential — unchanged, `REAL_AI_PROVIDER = BLOCKED`.
- Everything database-related (real Postgres, migrations, seeds, integration, E2E, backup, restore) remains VERIFIED, carried forward from Phase 22 and re-confirmed this phase.

### Test counts: 48/48 unit (up from 41 — 7 new), **49/49 integration (real PostgreSQL)**, **9/9 Playwright E2E (real PostgreSQL)**.

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** (unchanged category from Phase 22 — same two environment/credential gaps, not new defects).

## [0.1.0-rc.5] — Phase 22: Real PostgreSQL Production Certification

Fifth release candidate, and the most significant one yet: **`REAL_POSTGRES = BLOCKED` is closed.** The user provisioned a least-privilege `bizpilot_app` role and `bizpilot_ai_dev` database on the local PostgreSQL 18 server and updated `backend/.env` directly — the first working real-networked-Postgres credential across five prior phases. Every database-dependent gate that was previously BLOCKED is now VERIFIED with direct evidence: real migrations, real seeds (idempotent, double-run), the full 49-test integration suite and 9-test Playwright E2E suite both passing against the real server, live transaction/concurrency/idempotency/credit-ledger proofs (including a raw SQL duplicate-insert rejected by the database's own unique constraint), a real `pg_dump` backup, and a real restore verified row-for-row across all 44 tables.

### Fixed

- **`perf-smoke.ts`'s report header was hardcoded to say "PGlite-native engine" regardless of which engine actually ran.** Every prior phase's report was correct only because PGlite was the only engine ever exercised; the first real-Postgres run this phase would have silently mislabeled its own numbers. Now reads the label from `env.USE_PGLITE_ADAPTER` at runtime. (`backend/src/scripts/perf-smoke.ts`)

### Added

- `docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md` — the full evidence report: connection, migration, structural (44 tables/39 enums/100 FKs/149 indexes/pgcrypto present), seed, 49/49 integration, 9/9 E2E, transaction/concurrency/idempotency/credit-ledger/rollback proofs, real backup+restore, security, observability, and real-vs-PGlite performance — all against the real networked server, clearly distinguished from every prior phase's PGlite-only evidence.
- Formal decision on the Phase 20-identified declared-but-unreachable workflow states (`RETRYING`, `PENDING/FAILED→CANCELLED`): **intentionally reserved** (Option C), documented directly on `VALID_TRANSITIONS` with a new decision-encoding test file (`workflow-engine.reserved-transitions.test.ts`, 4 tests) rather than left ambiguous. (`backend/src/modules/workflows/workflow-engine.service.ts`)
- Real `pg_dump` backup of `bizpilot_ai_dev` (192KB, custom format) retained in the new `backups/` directory (added to `.gitignore` — never committed).
- Root-caused (not a product bug) and documented a Git-Bash/MSYS environment interaction: combining `set -a; source backend/.env; set +a` with spawning a Node process in the same shell call causes MSYS to mangle any exported value that looks like an absolute POSIX path (`API_PREFIX=/api/v1` → a Windows path), breaking every API route while `/health/*` kept working. Diagnosed via direct Express router-stack introspection; never affected the actual application in any successful run this phase.

### Known limitations (changed from every prior phase)

- **No longer a limitation**: real networked PostgreSQL, real migrations, real seeds, real integration/E2E test runs.
- Still open: Docker remains unavailable in this environment (`DEPLOYMENT_RUNTIME = BLOCKED — ENVIRONMENT`, not a defect); no real AI provider credential (`REAL_AI_PROVIDER = BLOCKED`, mock remains the deliberate, supported default).
- The real-Postgres performance numbers in this phase's report are single-run, n≤15 samples against a local development-grade server — not a production-scale load test.

### Test counts: 41/41 unit, **49/49 integration (against real PostgreSQL, not PGlite)**, **9/9 Playwright E2E (against real PostgreSQL, not PGlite)**.

### Release verdict: **RELEASE CANDIDATE — MINOR BLOCKERS** (upgraded from `RELEASE CANDIDATE — BLOCKED`, carried by every phase since Phase 18).

## [0.1.0-rc.4] — Phase 21: Production Certification & Release Engineering

Fourth release candidate. Phase 21's mandate was to re-certify the whole system from first principles (not trust Phase 20's report) with real PostgreSQL as the primary gate. Real Postgres access remains BLOCKED (fifth consecutive phase; the user is actively provisioning a `bizpilot_app` role). What makes this phase different: live HTTP probing against a running server — not just code review — surfaced two real HIGH-severity bugs that three prior phases of code review had missed, plus a tooling defect that had silently invalidated the two most important performance measurements in every prior phase's report.

### Fixed

- **`USE_PGLITE_ADAPTER=false` silently became `true`.** `z.coerce.boolean()` is `Boolean(value)` under the hood, and `Boolean("false")` is `true` in JavaScript — any non-empty string is truthy. Explicitly setting `USE_PGLITE_ADAPTER=false` (a natural thing for an operator to do defensively) silently pointed the app at an ephemeral, in-memory, non-persistent database instead of the real one named by `DATABASE_URL`. Found live: a workspace-creation request 500'd with "OWNER system role is not seeded" immediately after the role had been directly confirmed present in the real database. Replaced with a `booleanEnvVar()` helper that only accepts the literal strings `"true"`/`"false"`, failing validation on anything else. 3 new regression tests. (`backend/src/config/env.ts`, `backend/src/config/env.production-guard.test.ts`)
- **No production-config misconfiguration guards existed at all.** Production could previously boot with a `localhost` CORS origin or database URL, or a known dev-placeholder JWT secret, with zero validation. Added a `superRefine` that fails startup in production for each of these, plus identical `JWT_SECRET`/`JWT_REFRESH_SECRET`, plus `USE_PGLITE_ADAPTER=true`; `AI_PROVIDER=mock` in production is now an explicit startup warning rather than silent (it remains a supported, deliberate operating mode). 9 new regression tests. (`backend/src/config/env.ts`)
- **`perf-smoke.ts`'s two heaviest measurements ("workflow create+complete", "approval") had been invalid since they were introduced.** The script's synthetic business profile was missing `industry`, a field optional at the API layer but required by `marketing-autopilot.steps.ts`'s `validate_context` step (a permanent, never-retried failure) — every prior phase's timing for these two operations was actually measuring an instant step-1 rejection (~20-40ms), not the real operation. Separately, the approval-timing loop reused the workflow-creation loop's workspace, whose 100-credit starter allowance the workflow-creation loop had *exactly* exhausted (5 runs × 20 credits) — every approval attempt then correctly hit `InsufficientCreditsError`, itself a valid live demonstration of the cost guardrail working, but not what the metric claimed to measure. Fixed both; the corrected numbers are 15-25x different from every previously reported figure for these two operations. Real customers were never at risk from either defect — the underlying `industry` gap is closed at the UI layer (`OnboardingPage.tsx`'s `required` field) and the credit guardrail was always working correctly. (`backend/src/scripts/perf-smoke.ts`)

### Added

- `docs/PHASE_21_SECURITY_CERTIFICATION.md` — findings table with severity/attack/impact/evidence/fix/regression-test/status for every issue found or probed-and-ruled-out this phase.
- `docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md` — the full 33-section evidence report for this phase.
- `docs/FIRST_CUSTOMER_PRODUCTION_CHECKLIST.md` — the real customer journey, step by step, each row backed by either the Playwright suite or a live curl session run this phase, plus explicit known-scope limitations.
- `docs/DISASTER_RECOVERY_RUNBOOK.md` extended with 9 full incident playbooks (database outage, AI outage, auth compromise, tenant-isolation incident, runaway workflow, cost spike, migration failure, bad deployment, data corruption), each with DETECTION/CONTAINMENT/RECOVERY/VALIDATION/POSTMORTEM grounded in this repository's actual code.
- Live re-verification this phase (not re-citation) of tenant isolation, RBAC, authentication, and general input/API security via real curl probes against a running server: mass assignment, cross-tenant access, auth rate limiting, malformed/oversized/SQL-injection-style input — all confirmed correctly handled, zero unexpected 500s.
- Live demonstration of the cost guardrail under genuine exhaustion: a real workspace's 100-credit starter allowance was fully spent by 5 real workflow runs, and a 6th correctly failed with `InsufficientCreditsError` rather than proceeding or silently over-billing.

### Known limitations (unchanged from Phase 20, re-verified still true)

- No real networked PostgreSQL server has ever been verified (a real server exists in this environment; working credentials have not been obtained across five phases now).
- No real deployment, backup, or restore has ever been executed.
- No real AI provider credential has ever been used.
- The workflow state machine's `RETRYING` state and two `CANCELLED` transitions remain declared but unreachable by any current code path — documented, not fixed (low risk, out of this phase's mandatory scope).

### Test counts: **37/37 unit** (up from 25 — 12 new tests for the two config fixes), 49/49 integration (unchanged count, fully re-run), 9/9 Playwright E2E (unchanged).

## [0.1.0-rc.3] — Phase 20: Production Certification & Reliability Hardening

Third release candidate. Phase 20's mandate was to fix — not just document — the two workflow-reliability risks Phase 19 found by code review and left unfixed, then re-certify the whole system with fresh evidence. Real PostgreSQL access remains BLOCKED (fourth consecutive phase); every fix below was implemented and regression-tested against the same PGlite-native engine used since Phase 17, with the new database migration hand-authored (Prisma's `migrate dev` requires a live Postgres connection, unavailable here) and structurally validated via `prisma validate`/`prisma generate` plus a full migration replay through the PGlite adapter.

### Fixed

- **ContentAsset retry could create duplicate content (Phase 19 finding, unfixed until now).** Determined the real domain identity of a generated content piece is `(workflowInstanceId, day, platform, contentType)` — NOT `(workflowInstanceId, day)` alone, since the calendar schema deliberately allows 28-31 items with no day-uniqueness (a real calendar can legitimately schedule different content on the same day across different platforms). Added a database-level unique constraint on the correct tuple and converted `persist_assets` from `create` to `upsert`, so a retried step re-affirms the same rows instead of duplicating them — and never silently reverts a human's edit or approval made between two attempts. 4 new regression tests, including a live proof that the DB constraint is enforced, not just application logic. (`backend/prisma/schema.prisma`, `backend/prisma/migrations/20260809160000_content_asset_domain_identity/`, `backend/src/modules/marketing-autopilot/marketing-autopilot.steps.ts`)
- **Concurrent approval race (Phase 19 finding, unfixed until now).** `approveInstance`/`rejectInstance` used a find-then-check-then-update sequence that two concurrent requests could both pass before either wrote — replaced with an atomic conditional `updateMany` keyed on `status: 'AWAITING_APPROVAL'`, so only one of two truly concurrent requests can ever win; the other correctly receives the same 409 a sequential repeated-approval already produced. As a side effect, this also closes a latent gap where the old code would have let `approveInstance` incorrectly act on a `PENDING` (not-yet-started) instance. New live concurrency test (`Promise.all`) proves exactly one 200 and one 409, and that the remaining workflow steps never double-ran. (`backend/src/modules/workflows/workflow-engine.service.ts`)

### Added

- Workflow state-machine transition audit: confirmed `WorkflowInstanceStatus.RETRYING` and the `PENDING→CANCELLED`/`FAILED→CANCELLED` table entries are declared but never actually reachable by any current code path — documented honestly rather than silently assumed exercised.
- p99 added to the performance smoke test alongside the existing p50/p95, plus two new measured operations (content-asset list, approval) — all real measurements, explicitly labeled as statistically thin at this sample size rather than presented as a tail-latency SLA. (`backend/src/scripts/perf-smoke.ts`)
- `.env.example` rewritten with purpose/required-optional/safe-example/production-requirement documentation for every variable, including two that were previously undocumented (`AI_PROVIDER`, `USE_PGLITE_ADAPTER`).
- `docs/PHASE_20_PRODUCTION_CERTIFICATION.md` — the full evidence report for this phase.

### Known limitations (unchanged from Phase 19, re-verified still true)

- No real networked PostgreSQL server has ever been verified (a real server exists in this environment; working credentials have not been obtained across three phases now).
- No real deployment, backup, or restore has ever been executed.
- No real AI provider credential has ever been used.

### Test counts: 25/25 unit, **49/49 integration** (up from 44 in Phase 19 — 5 new tests: 4 for ContentAsset idempotency, 1 for concurrent approval), 9/9 Playwright E2E (unchanged from Phase 19).

## [0.1.0-rc.2] — Phase 19: Production Operations, Deployment & Reliability

Second release candidate. Phase 19 turned the Phase 18 Release Candidate toward genuine deployability: production hardening, observability, cost guardrails, structural (not yet runtime-verified) Docker/CI artifacts, a full set of operational runbooks, and the "resume my existing plan" product fix flagged in Phase 18. The infrastructure blocker is unchanged from Phase 18 — real, credentialed, networked PostgreSQL access was not obtained this phase either.

### Fixed

- **Oversized request bodies (>2MB) returned a generic 500 instead of 413.** `error-handler.ts` only recognized one body-parser error type (`entity.parse.failed`, the Phase 18 malformed-JSON fix); generalized the mapping by `.type` and added `PayloadTooLargeError`. Found via a live security probe this phase. (`backend/src/common/errors/app-error.ts`, `backend/src/common/middlewares/error-handler.ts`)
- **"Resume my existing plan" gap (Phase 18 Section 27).** Navigating to Marketing Autopilot after generating a plan always showed the "start new" form instead of the existing calendar. Added `GET /workflow-instances/latest`, wired the frontend to resume automatically with an explicit "start a new plan" escape hatch, verified live in a real browser. (`backend/src/modules/workflows/{workflow-engine.service,workflow.controller,workflow.routes}.ts`, `frontend/src/features/marketing-autopilot/{api/marketing-autopilot.api,pages/MarketingAutopilotPage}.tsx`)
- **No ceiling on request duration.** A stalled downstream dependency (AI provider, database) could hold a server connection open indefinitely. Added `requestTimeout` middleware (`REQUEST_TIMEOUT_MS`, default 30s). (`backend/src/common/middlewares/request-timeout.ts`)
- **No process-level crash handling.** `uncaughtException`/`unhandledRejection` were unhandled, leaving process state after an unknown failure undefined. Added handlers that trigger the existing graceful-shutdown path rather than limping on in a corrupted state. (`backend/src/server.ts`)

### Added

- `GET /metrics` — in-memory operational counters (HTTP requests/errors, workflow executions/failures, AI requests/failures, database errors, authentication failures) and a bounded latency histogram (p50/p95). Intentionally unauthenticated but meant to be firewalled/internal-only in a real deployment. (`backend/src/common/observability/metrics.ts`)
- `compression` middleware (gzip response bodies) — a real gap found during this phase's production-hardening audit, not previously present.
- Cost guardrail: `workflowExecutionRateLimit`, keyed by workspaceId, capping workflow-execution starts independent of AI-credit balance (`WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS`, default 20/hour). (`backend/src/common/middlewares/rate-limit.ts`)
- Structural (not yet runtime-verified — Docker is unavailable in the environment this was authored in) production Docker images: `backend/Dockerfile` (multi-stage, non-root, minimal runtime, correct signal handling), `frontend/Dockerfile` + `frontend/nginx.conf`.
- `.github/workflows/ci.yml` — full CI pipeline (install → typecheck → lint → unit → integration → build → migration validation → security audit → E2E → artifact → staging → smoke → manual production-approval gate → production), every command re-using one already verified locally this phase; the pipeline itself has never run on an actual GitHub Actions runner.
- New documentation: `docs/PRODUCTION_ENVIRONMENT.md`, `docs/OBSERVABILITY_RUNBOOK.md`, `docs/SECURITY_RELEASE_CHECKLIST.md`, `docs/DISASTER_RECOVERY_RUNBOOK.md`, `docs/PRODUCTION_RELEASE_RUNBOOK.md`, `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`.
- 4 new integration tests (`GET /workflow-instances/latest`, including a tenant-isolation and a validation-error case) and 1 new Playwright E2E test (resume-plan verified in a real browser).

### Known issues (not fixed this phase — see `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`)

- `ContentAsset` has no unique constraint on `(workflowInstanceId, day)` — a retried `persist_assets` step (plausible against a real network-attached Postgres, not reproducible against the PGlite-native test path) could create a duplicate set of 30 assets rather than being deduplicated. Found by schema/code review this phase, not by a live failure; the correct fix requires a schema migration verified against a real Postgres server, which remains blocked.
- Concurrent (not sequential) double-approval of the same workflow instance has no row-level lock — a plausible race, not reproduced or fixed this phase.
- No backup has ever been taken; no restore has ever been executed (`RESTORE_TEST = BLOCKED`).
- No real deployment, staging or production, has ever been attempted.
- No real AI provider credential has ever been used.

### Integration test count: 44/44 passing (up from 40 in Phase 18). Unit tests: 25/25. Browser E2E: 9/9 (up from 8).

## [0.1.0-rc.1] — Phase 18: Production Launch Validation

First release candidate. Phase 18 found and fixed five real, previously-undetected bugs through empirical verification (real Postgres access, the first browser-level E2E suite, and a live manual walkthrough) — none of these were caught by any prior phase's HTTP-only integration testing.

### Fixed

- **Critical — Marketing Autopilot approval crashed the entire app.** `approveInstance`/`rejectInstance` returned a bare `WorkflowInstance` row with no `contentAssets`/`stepRuns` relations; the frontend set that response directly as state and immediately called `.slice()` on the (now `undefined`) `contentAssets` array, throwing an uncaught render error that unmounted the whole React tree (no error boundary exists). This fired on every real approval — the single most-used action in the product's flagship workflow. Fixed by having `approveInstance`/`rejectInstance` return the same fully-populated shape `getInstance` always has. (`backend/src/modules/workflows/workflow-engine.service.ts`)
- **Critical — `Button asChild` crashed the Dashboard for every user.** `Button`'s `asChild` mode passed sibling spinner/icon nodes alongside `children` into Radix's `Slot`, which requires exactly one child element. Both Dashboard CTA buttons use `asChild`, so the Dashboard was blank on load for every user until this phase. Fixed by rendering `children` alone when `asChild` is set. (`frontend/src/shared/components/ui/Button.tsx`)
- **Critical — returning users could never get back into their workspace.** No code path minted a workspace-scoped access token except workspace *creation*; login always left `workspaceId: null`, so `RequireWorkspace` sent every returning login through onboarding again (which would create a duplicate workspace) rather than resolving the user's existing one. Added `POST /workspaces/:workspaceId/select` (mints a token for an existing ACTIVE membership) and wired the frontend to call it after login. (`backend/src/modules/workspaces/{workspace.service,workspace.controller,workspace.routes}.ts`, `frontend/src/features/auth/pages/LoginPage.tsx`, `frontend/src/features/onboarding/api/onboarding.api.ts`)
- **High — a closure-staleness bug would have silently broken the workspace-select fix above.** `AuthProvider`'s `setWorkspace` closed over React state `auth` rather than reading fresh; calling `login()` and `setWorkspace()` within the same handler (exactly what the fix above does) would see a stale `null` and no-op. Fixed by reading `getStoredAuth()` fresh instead of the closed-over value. (`frontend/src/app/providers/AuthProvider.tsx`)
- **High — a mistyped password produced an inexplicable page reload instead of an error message.** The global Axios 401-response interceptor treated *any* 401 as an expired session (attempting a token refresh, then forcing `window.location.href = '/login'`), including 401s from `/auth/login` itself for wrong credentials — wiping the in-flight error state via a full page reload before the "wrong password" message could render. Fixed by excluding the auth endpoints from the refresh/redirect interceptor. (`frontend/src/shared/lib/api-client.ts`)
- **Medium — a race between two concurrent identical workflow requests could 500.** `startWorkflow`'s idempotency-key race-recovery path checked for Prisma's mapped `P2002` error code, but Prisma's driver-adapter path can surface the raw Postgres SQLSTATE `23505` instead — the recovery branch silently never fired, and a genuine concurrent duplicate request (e.g. a double-click) produced an unhandled 500 instead of returning the existing instance. Fixed by accepting either code. (`backend/src/modules/workflows/workflow-engine.service.ts`)
- **Medium — transient AI/upstream failures were never actually retried.** `AppError`'s base constructor hardcoded `this.name = 'AppError'` for every subclass, so `isTransientError()`'s `.name === 'UpstreamProviderError'` check could never match — every upstream failure went straight to `FAILED` on the first attempt, with the documented 3-attempt exponential-backoff retry never engaging. Fixed the root cause (`this.name = new.target.name`) and switched the check to `instanceof`. (`backend/src/common/errors/app-error.ts`, `backend/src/modules/workflows/workflow-engine.service.ts`)
- **Low — malformed JSON request bodies returned a generic 500 instead of 400.** `express.json()`'s body-parser `SyntaxError` wasn't recognized by the error handler and fell through to the catch-all 500 branch. Added explicit recognition mapping it to a proper `400 VALIDATION_MALFORMED_JSON`. (`backend/src/common/middlewares/error-handler.ts`, `backend/src/common/errors/app-error.ts`)

### Added

- `POST /workspaces/:workspaceId/select` — mints a workspace-scoped access token for an existing ACTIVE membership (see Fixed, above).
- First browser-level (Playwright) E2E suite: golden path (register → onboard → generate → edit → approve → refresh → logout/login) plus 5 negative/edge-case tests. (`e2e/golden-path.spec.ts`, `playwright.config.ts`)
- RBAC negative-path integration tests closing a gap open since Phase 17 (VIEWER/MEMBER correctly rejected with 403; MANAGER correctly succeeds). (`backend/src/modules/workspaces/rbac.integration.test.ts`)
- Tenant-isolation attack coverage extended from 6 to 13 tests: PATCH/DELETE/POST cross-tenant attempts against contact/lead/content-asset/workflow-instance/business-profile, not just GET. (`backend/src/modules/workspaces/tenant-isolation.integration.test.ts`)
- Failure-resilience integration tests driving the retry/backoff engine directly with controlled transient and permanent failures. (`backend/src/modules/workflows/workflow-failure.integration.test.ts`)
- Concurrency and repeated-approval integration tests for the Marketing Autopilot workflow. (`backend/src/modules/marketing-autopilot/marketing-autopilot.integration.test.ts`)
- Performance smoke test script covering login, workspace load, dashboard load, CRM list, workflow create+complete, and a DB-heavy list query. (`backend/src/scripts/perf-smoke.ts`)
- `VERSION` and this `CHANGELOG.md`.

### Known issues (not fixed this phase — see `docs/PHASE_18_PRODUCTION_LAUNCH_VALIDATION.md` and `docs/FIRST_CUSTOMER_READINESS.md`)

- No "resume my existing plan" view: navigating back to Marketing Autopilot after approval shows the "start a new plan" form again, not the already-approved calendar. Data is safely persisted; the UI doesn't surface it.
- `InvalidCredentialsError`'s message ("Email or password is incorrect.") and other backend error strings are hardcoded English, inconsistent with the fully Azerbaijani frontend.
- No real networked PostgreSQL server was verified against this phase either — see the release gate for the exact reason and unblock path.

### Integration test count: 40/40 passing (up from 19 at the end of Phase 17). Unit tests: 25/25. Browser E2E: 8/8.
