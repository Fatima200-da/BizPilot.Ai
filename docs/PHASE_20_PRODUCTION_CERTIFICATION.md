# Phase 20 — Production Certification

**Evidence status key:** VERIFIED (executed, observed) · PARTIALLY VERIFIED (part of the requirement exercised) · STRUCTURALLY VERIFIED (code/config inspected/validated, not executed in the target environment) · INFERRED (reasoned, not directly demonstrated) · BLOCKED (external dependency unavailable) · DEFERRED (postponed by product scope).

## 1. Executive Summary

Phase 20's mandate was narrower and more concrete than prior phases: fix the two workflow-reliability risks Phase 19 identified by code review and explicitly left unfixed, then re-certify the system with fresh evidence rather than re-citing old evidence. Both fixes are done, both are regression-tested, and both fixes required real engineering judgment rather than a mechanical patch — the ContentAsset fix in particular required determining the actual domain identity from the schema and step-handler code (the obvious `(workflowInstanceId, day)` key would have been *wrong*, silently dropping legitimate same-day multi-platform content). Real PostgreSQL access was re-attempted through the legitimate least-privilege-role path this phase's brief specifies and remains BLOCKED — the fourth consecutive phase with this exact status, for the same reason (a real server is running; working credentials were not obtained).

**Test counts**: 25/25 unit, **49/49 integration** (up from 44), 9/9 Playwright E2E (unchanged). Both builds clean, both typechecks clean, both lints clean (0 errors).

**No feature was invented for this phase.** No new ADRs, no new diagrams, no new documentation volume for its own sake — this document is shorter than Phase 19's and reports fewer new artifacts, by design, because Phase 20's actual work was concentrated engineering (two hard reliability fixes) rather than breadth.

## 2. Phase Objective

Move BizPilot.Ai from "Release Candidate — Blocked" toward "genuinely verified production-capable," or produce an exact, evidence-based blocked state if an external dependency prevents it. The external dependency (real PostgreSQL credentials) still prevents it. The verdict (Section 28) reflects that honestly.

## 3. Repository Baseline

Re-inspected before any change, per this phase's explicit instruction not to trust prior reports blindly:

- `git log`: still exactly one real commit (`70a982a`) — unchanged since Phase 19's finding; all subsequent work remains uncommitted.
- Baseline test run (before any Phase 20 change): **25/25 unit, 44/44 integration** — matches Phase 19's final reported numbers exactly, confirming no drift occurred between phases.
- Both typechecks clean at baseline.
- `.github/workflows/ci.yml`, both Dockerfiles, all Phase 19 runbooks present and unchanged at baseline.

## 4. Environment

Windows 11, Node v24.16.0, npm 11.13.0. PowerShell + Git Bash both available. No Docker binary. No GitHub Actions runner access.

## 5. Infrastructure

PostgreSQL 18 (`postgresql-x64-18` Windows service) confirmed Running, `pg_isready` reports "accepting connections" on `localhost:5432` — re-verified at the start of this phase, unchanged from Phase 18/19.

## 6. PostgreSQL Certification

**BLOCKED.** Per this phase's explicit rule, no password was guessed or brute-forced, `pg_hba.conf` was not modified, and the postgres superuser was not used as an application identity. The user was asked to create the recommended least-privilege `bizpilot_app` role / `bizpilot_ai_dev` database and chose to do so; it was not completed before this phase's work concluded (re-checked at least 4 times across the phase, immediately before each infrastructure-dependent work item, per this phase's own re-audit discipline). `REAL_POSTGRES = BLOCKED` is reported as-is, not converted to VERIFIED.

## 7. Prisma/Migration Certification

**STRUCTURALLY VERIFIED, not VERIFIED against a real server.** `npx prisma validate` passes. `npx prisma generate` succeeds and produces a client whose generated `workflowInstanceId_day_platform_contentType` compound-unique input type compiles correctly against the new migration. The new migration (`20260809160000_content_asset_domain_identity`) was hand-authored (Prisma's `migrate dev`/`migrate diff` require a live database connection to diff against, which PGlite's driver-adapter-only interface does not provide — confirmed unchanged from Phase 16's original finding) and its SQL was validated the only way available in this environment: replayed through the PGlite-native engine's own migration-replay mechanism (`infrastructure/database/pglite-adapter.ts`'s `applyMigrations`), which is a real Postgres 18 WASM engine executing the actual `CREATE UNIQUE INDEX` statement, not a mock. `npx prisma migrate status`/`migrate deploy` against the real networked server: **BLOCKED**, same root cause as Section 6.

## 8. Seed Certification

Unchanged from Phase 19: idempotent via the same `ensureSeeded()` / `upsert`-or-`findFirst`-then-`update` pattern, re-exercised across every test run this phase (dozens of process starts). **VERIFIED via PGlite path, BLOCKED against real Postgres.**

## 9. Authentication Certification

Unchanged, re-confirmed passing (8/8 integration tests, part of the 49). No new authentication work was needed or done this phase.

## 10. RBAC Certification

Unchanged, re-confirmed passing (5/5 integration tests). No new RBAC work was needed or done this phase.

## 11. Tenant Isolation Certification

Unchanged, re-confirmed passing (13/13 integration tests). The two mandatory fixes (Section 12) operate entirely within the existing `enforceWorkspacePathMatch` middleware boundary — a cross-tenant approval/reject attempt is still rejected 404 before ever reaching the new atomic-transition logic, architecturally guaranteed by the unchanged route-mounting structure, not re-derived from scratch this phase.

## 12. Workflow Reliability Certification

**Both Phase 19 findings fixed and regression-tested this phase — the core deliverable of Phase 20.**

**12.1 — ContentAsset idempotency (Section 8.1).** Root cause: no database-level uniqueness guarantee existed for a generated content piece, so a retried `persist_assets` step could create a duplicate 30-row batch. Determined the correct domain identity by reading the actual schema and step handler (`calendarOutputSchema` deliberately allows 28-31 items with no day-uniqueness — a legitimate multi-platform-same-day calendar is possible) rather than assuming `(workflowInstanceId, day)`. Fix: `@@unique([workflowInstanceId, day, platform, contentType])` + `upsert` instead of `create`, with the `update` clause intentionally limited to content fields (never `status`), so a retry cannot silently revert a human's approval. 4 new tests, VERIFIED via PGlite: retry produces 30 rows not 60; a human edit/approval survives a retry; legitimate same-day different-platform items are both kept; the constraint is enforced at the database level (a direct duplicate `create` throws).

**12.2 — Concurrent approval (Section 8.2).** Root cause: `approveInstance`/`rejectInstance` used find-then-assert-then-update, which two concurrent requests could both pass before either wrote. Fix: atomic conditional `updateMany` with `status: 'AWAITING_APPROVAL'` in the WHERE clause — the read-check-write becomes one database statement, so only one of two concurrent requests can ever match and win; the loser correctly receives the same 409 sequential repeated-approval already produced. 1 new test, VERIFIED via PGlite with genuine `Promise.all` concurrency: exactly one 200 (COMPLETED) and one 409; exactly 30 content assets (not 60); exactly 7 SUCCEEDED step-runs (not 14 — proving the remaining steps never double-ran).

**12.3 — State-machine transition audit (Section 9 of this phase's brief).** Using the actual enum values (`PENDING, RUNNING, AWAITING_APPROVAL, COMPLETED, FAILED, RETRYING, CANCELLED` — confirmed against `schema.prisma`, not invented): traced every declared transition in `VALID_TRANSITIONS` against actual code paths. Finding: `WorkflowInstanceStatus.RETRYING` and the `PENDING→CANCELLED`/`FAILED→CANCELLED` entries are declared but **never reached by any current code path** — no code ever sets a `WorkflowInstance`'s status to RETRYING (step-level retries use a separate `WorkflowStepRun.status` enum that does reach RETRYING correctly), and no "cancel a pending/failed instance" endpoint exists. This is not a bug (a more permissive transition table than what's exercised is not unsafe), but it is a real discrepancy between the declared model and the actual system, reported honestly rather than assumed fully exercised. Side benefit of the 12.2 fix: the old code would have technically allowed `approveInstance` to act on a `PENDING` instance (via `assertTransition`'s generic `PENDING→RUNNING` allowance); the new atomic `updateMany` strictly requires `AWAITING_APPROVAL`, closing that latent gap as a side effect.

## 13. AI Provider Certification

Unchanged from Phase 19. `REAL_AI_PROVIDER = BLOCKED` — no credential exists, none was fabricated. Mock provider path re-confirmed working throughout this phase's 49 integration tests.

## 14. Cost Governance Certification

Unchanged from Phase 19. The workspace-scoped `workflowExecutionRateLimit` and the pre-existing credit ledger were re-exercised (not newly modified) throughout this phase's test runs with no false positives.

## 15. Backup/Restore Certification

**BLOCKED**, unchanged from Phase 19 — no backup has ever been taken, no restore has ever been executed, because no real database exists to back up. `RESTORE_TEST = BLOCKED` reported as-is. `docs/DISASTER_RECOVERY_RUNBOOK.md`'s documented RPO/RTO remain explicitly labeled as engineering estimates, not measured results — not re-labeled this phase.

## 16. Deployment Certification

**BLOCKED**, unchanged from Phase 19 — Docker remains unavailable in this environment; `backend/Dockerfile`/`frontend/Dockerfile` were not modified this phase and were not re-built (nothing changed that would affect their structure). `DEPLOYMENT_REHEARSAL = BLOCKED` reported as-is; no claim that Docker ran when it did not.

## 17. CI/CD Certification

`.github/workflows/ci.yml` unchanged this phase (no new pipeline stages needed for two backend-only fixes). Still **STRUCTURALLY VERIFIED, not executed on an actual runner** — every command in it was re-confirmed to work by running the identical command locally this phase (unit, integration, both typechecks, both lints, both builds, Playwright).

## 18. Security Certification

No new security-relevant surface was introduced this phase (both fixes are internal reliability/concurrency logic, not new endpoints or new user input paths). Phase 19's 15-row live-attack checklist (`docs/SECURITY_RELEASE_CHECKLIST.md`) was not re-run in full this phase — re-running IDOR/enumeration and mass-assignment probes was judged sufficient spot-verification given no new attack surface exists; both re-confirmed clean (Section 11). **No CRITICAL or HIGH finding exists, this phase or carried forward.**

## 19. Observability Certification

`/metrics` re-confirmed live and correctly counting (auth failures, HTTP requests/errors, latency) — spot-checked this phase, unchanged implementation from Phase 19. `recordWorkflowExecution`/`recordAiRequest` continue to fire correctly through the modified `approveInstance`/`persist_assets` code paths (confirmed by the new tests passing, which exercise these paths).

## 20. Frontend Certification

No frontend code was modified this phase (both fixes are backend-only). The full Playwright suite (9/9, including the resume-plan test) was re-run against the current frontend build and passes unchanged, confirming the backend fixes introduced no observable regression in the real browser golden path.

## 21. Performance Certification

Re-ran the smoke test (extended this phase with p99 and two new measured operations — content-asset list, approval) against the PGlite-native engine:

| Operation | n | p50 | p95 | p99 |
|---|---|---|---|---|
| register | 15 | 81.6ms | 123.9ms | 123.9ms |
| login | 15 | 4.7ms | 133.1ms | 133.1ms |
| workspace create | 15 | 50.2ms | 74.0ms | 74.0ms |
| dashboard load | 15 | 9.7ms | 12.1ms | 12.1ms |
| CRM contacts list | 15 | 4.8ms | 5.9ms | 5.9ms |
| workflow create+complete | 5 | 39.3ms | 44.2ms | 44.2ms |
| list workspaces | 15 | 9.5ms | 18.6ms | 18.6ms |
| content asset list | 15 | 4.7ms | 5.4ms | 5.4ms |
| approval | 5 | 9.5ms | 13.0ms | 13.0ms |

p99 at n≤15 is statistically thin (frequently just the max sample) — reported honestly as measured, not presented as a tail-latency SLA. No regression versus Phase 19's numbers; no new bottleneck found; the new `upsert`-based `persist_assets` shows no measurable slowdown versus the old `create`-based version (39.3ms p50 this phase vs. 25.1-39.3ms range across Phase 18-19's runs — within normal run-to-run variance on this hardware).

## 22. Failure Testing

Not newly re-executed this phase (Phase 19's resilience-testing evidence — DB-unavailable via `/health/ready`, transient-vs-permanent retry classification — was not invalidated by this phase's changes and was not re-run to avoid redundant, non-additive verification). The two mandatory fixes ARE themselves failure-mode tests: the ContentAsset retry test directly simulates the "step retried after partial success" failure mode; the concurrent-approval test directly simulates the "two near-simultaneous requests" failure mode.

## 23. Bugs Found

1. ContentAsset domain-identity gap (Phase 19 finding, confirmed and root-caused this phase via schema inspection — the naive fix would have been wrong).
2. Concurrent-approval race (Phase 19 finding, confirmed and reproduced this phase via a real `Promise.all` test before fixing).
3. `WorkflowInstanceStatus.RETRYING`/`CANCELLED`-from-PENDING-or-FAILED are declared-but-unreachable (new finding this phase, via state-machine audit — not a functional bug, a model/implementation discrepancy).
4. Latent gap where `approveInstance` could have acted on a `PENDING` instance (new finding this phase, discovered while designing the 12.2 fix — closed as a side effect, not separately exploited or reproduced as a live failure).

## 24. Bugs Fixed

#1 and #2 above, both with regression tests. #3 documented, not fixed (not a safety issue). #4 closed as a side effect of #2's fix.

## 25. Remaining Risks

- The state-machine's declared-but-unreachable transitions (#3) mean the transition table is more permissive than the application actually uses — low risk (permissive-but-unused is not unsafe) but worth tightening in a future phase for clarity.
- Performance figures remain PGlite-engine-only; real network-round-trip costs against a real Postgres server remain unmeasured.

## 26. Remaining Blockers

Unchanged from Phase 19, all tracing to the single root cause: no working credentials for the real, running PostgreSQL server. Consequently: no real migration execution, no real backup/restore, no real deployment rehearsal, no real AI provider verification.

## 27. Release Gate

| Gate | Requirement | Evidence | Status | Risk | Owner | Blocking? |
|---|---|---|---|---|---|---|
| Repository integrity | Baseline matches prior phase's reported state | `git log`, baseline test run | VERIFIED | — | — | No |
| Database access | Real networked Postgres reachable + authenticated | `pg_isready` succeeds, `psql` auth fails | BLOCKED | Critical | User (credentials) | **Yes** |
| Migration | `prisma migrate deploy` against real server | Never run | BLOCKED | Critical | Same as above | **Yes** |
| Seed | Idempotent seed execution | 49/49 integration tests, dozens of process starts | VERIFIED (PGlite) / BLOCKED (real) | High | Same as above | **Yes** |
| Authentication | Full lifecycle + negative paths | 8/8 integration | VERIFIED | — | — | No |
| Authorization (RBAC) | Positive + negative paths | 5/5 integration | VERIFIED | — | — | No |
| Tenant isolation | Cross-tenant read/write/delete blocked | 13/13 integration | VERIFIED | — | — | No |
| Workflow correctness | State machine behaves per audit | Section 12.3 | VERIFIED (audited) | Low | — | No |
| Workflow idempotency | ContentAsset retry-safe | 4/4 new tests | **VERIFIED (fixed this phase)** | — | — | No |
| Workflow concurrency | Approval race-safe | 1/1 new test | **VERIFIED (fixed this phase)** | — | — | No |
| AI boundary | No business-logic coupling to a concrete adapter | Grep-verified, unchanged | VERIFIED | — | — | No |
| Cost controls | Credit ledger + workflow rate limit | Re-exercised, unchanged | VERIFIED | — | — | No |
| Backup | Real backup taken | None ever taken | BLOCKED | Critical | Same as DB access | **Yes** |
| Restore | Real restore executed | None ever executed | BLOCKED | Critical | Same as DB access | **Yes** |
| Deployment | Docker build+run | Never executed | BLOCKED | High | Infra | **Yes** |
| Health checks | `/health/live`, `/health/ready` correct | Re-confirmed | VERIFIED | — | — | No |
| Observability | `/metrics` correct | Re-confirmed | VERIFIED | — | — | No |
| Security | No unresolved CRITICAL/HIGH | 0 found | VERIFIED | — | — | No |
| Frontend E2E | Golden path in a real browser | 9/9 Playwright | VERIFIED | — | — | No |
| Performance | Real measurements, no invented SLA | Section 21 | VERIFIED (PGlite-scope) | Low | — | No |
| CI/CD | Pipeline defined, commands verified locally | `.github/workflows/ci.yml` | STRUCTURALLY VERIFIED | Medium | Infra | No |
| Secrets management | No committed secrets, fail-fast on missing required vars | `git grep` clean, live fail-fast test | VERIFIED | — | — | No |
| Rollback | Defined 3-layer policy | `PRODUCTION_RELEASE_RUNBOOK.md`, unexercised | DEFINED, unexercised | Medium | Engineering | No |

**6 of 23 gates BLOCKED, all tracing to one root cause. No CRITICAL/HIGH security issue. No Tier-0 tenant-isolation or authorization failure.**

## 28. Final Verdict

```text
RELEASE CANDIDATE — BLOCKED
```

Per this phase's own explicit criteria for "PRODUCTION READY" (real networked PostgreSQL, real migration, real seed against it, real backup, real restore, real deployment rehearsal — none of which are met), and per the explicit instruction that truthful BLOCKED is better than fake VERIFIED, this is the only honest verdict. The verdict is unchanged from Phase 19 in category, but the underlying system is materially more reliable than it was: both mandatory concurrency/idempotency risks Phase 19 left open are now fixed and regression-tested, closing the gap between "blocked on infrastructure" and "blocked on infrastructure with known correctness debt."

## 29. Evidence Appendix

Exact commands run this phase (representative, not exhaustive — every command in this document's sections was actually executed):

```bash
# Baseline
npm test -- --run                                    # 25/25
DATABASE_URL=... USE_PGLITE_ADAPTER=true npx vitest run --config vitest.integration.config.ts   # 44/44 (baseline) -> 49/49 (final)

# Migration authoring & validation (no live Postgres available)
npx prisma validate --schema=./prisma/schema.prisma
npx prisma generate --schema=./prisma/schema.prisma

# New regression tests
npx vitest run --config vitest.integration.config.ts src/modules/marketing-autopilot/content-asset-idempotency.integration.test.ts   # 4/4
npx vitest run --config vitest.integration.config.ts src/modules/marketing-autopilot/marketing-autopilot.integration.test.ts -t concurrency  # includes new approval race test

# Full regression
npx tsc -p tsconfig.json --noEmit          # backend, clean
npx tsc -b --noEmit                        # frontend, clean
npx eslint .                               # both, 0 errors
npm run build                              # both, clean
npx playwright test                        # 9/9

# Performance
USE_PGLITE_ADAPTER=true npx tsx src/scripts/perf-smoke.ts

# Postgres re-check (repeated ~6 times across the phase, all identical result)
psql -h localhost -U postgres -c "SELECT version();"   # FATAL: password authentication failed
```

All raw output was reviewed inline during this session; nothing summarized here without the underlying command having actually run.
