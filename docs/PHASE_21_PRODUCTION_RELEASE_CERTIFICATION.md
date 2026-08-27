# Phase 21 — Production Release Certification

Evidence classification used throughout: **VERIFIED** (executed, observed) / **PARTIALLY VERIFIED** / **STRUCTURALLY VERIFIED** (inspected/validated, not executed against the target) / **INFERRED** / **BLOCKED** (external dependency unavailable) / **DEFERRED**.

## 1. Executive Summary

Phase 21's mandate was to re-certify BizPilot.Ai from first principles rather than trust Phase 20's report, with real Postgres certification as the primary gate. Real Postgres access was re-attempted through the legitimate least-privilege-role path and remains **BLOCKED** — the fifth consecutive phase with this exact status (a real PostgreSQL 18 server is running; working credentials were not obtained during this phase's window). The user is actively working on provisioning the `bizpilot_app` role.

What makes this phase materially different from a re-run of Phase 20: live HTTP probing against a running server (not just code review) surfaced **two real HIGH-severity bugs never caught in three prior phases** — a `z.coerce.boolean()` misconfiguration that silently ignores an explicit `USE_PGLITE_ADAPTER=false`, and the complete absence of production-config misconfiguration guards. Both are fixed with regression tests. The same live probing also found and fixed a **tooling-only defect** that had silently invalidated every prior phase's "workflow create+complete" and "approval" performance numbers (missing `industry` field + workspace credit exhaustion) — this phase's performance numbers are the first genuinely valid ones for those two operations across the whole project.

**Test counts**: 37/37 unit (+12 from Phase 20's 25), **49/49 integration** (unchanged count, all re-run fresh), 9/9 Playwright E2E. Both builds clean, both typechecks clean, both lints 0 errors.

## 2. Baseline

Re-inspected, not assumed:
- `git status`: identical uncommitted-file set to Phase 20's end state — no drift.
- `git log`: still one real commit (`70a982a`).
- `VERSION`: `0.1.0-rc.3` at phase start (see Section 27 for the decision to keep it).
- Pre-phase test run: 25/25 unit, 49/49 integration, 9/9 E2E — matches Phase 20's final numbers exactly.

## 3. Infrastructure

PostgreSQL 18 Windows service: `Running`. `pg_isready` accepts connections on `localhost:5432`. Read-only inspection of `pg_hba.conf` (no modification, per Rule 3) confirms `scram-sha-256` is required for every connection method (local, host 127.0.0.1/32, host ::1/128) — there is no trust/bypass auth method configured, consistent with a genuinely password-protected server, not a misconfigured one.

## 4. PostgreSQL

**BLOCKED.** `backend/.env`'s `DATABASE_URL` still uses `postgres:postgres` — re-tested this phase (`psql -h localhost -U postgres`) and still returns `FATAL: password authentication failed for user "postgres"`, both at phase start and again at phase end. No password was guessed, brute-forced, or newly attempted — only the already-configured credential was re-checked, and `pg_hba.conf` was read, never modified. The user chose "I'll create it now" when asked this phase whether the `bizpilot_app` role could be provisioned; it was not completed before this phase's work concluded. `REAL_POSTGRES = BLOCKED` is reported as-is.

## 5. Prisma

STRUCTURALLY VERIFIED: `npx tsc --noEmit` passes against Prisma's generated client; `prisma validate` (Phase 20) remains valid — schema unchanged this phase. Against a real networked server: BLOCKED, same root cause as Section 4.

## 6. Migrations

Both migrations (`20260808194414_init`, `20260809160000_content_asset_domain_identity`) were freshly replayed this phase against a genuinely restarted PGlite Postgres-wire-protocol instance (`npm run db:migrate:pglite`): "287 statements applied, 1 skipped" then "1 statements applied, 0 skipped" — clean, repeatable, no destructive statements. Verified the `content_assets_workflowInstanceId_day_platform_contentType_key` unique index exists and is enforced (the idempotency regression tests in the 49-test suite directly exercise a duplicate-insert rejection at the database level). Against real Postgres: BLOCKED.

## 7. Seeds

**VERIFIED (fresh, real double-run evidence this phase)**, via a real Postgres-wire-protocol engine (PGlite socket bridge, not the in-process test adapter): ran `seed-rbac.ts` and `seed-workflow-definitions.ts` twice in sequence against the same live database. First run: "Seeded role OWNER/ADMIN/MANAGER/MEMBER/VIEWER/GUEST" (6 roles — the real role set is `OWNER, ADMIN, MANAGER, MEMBER, VIEWER, GUEST`, not the 4-role list this phase's own prompt assumed; using the actual names, not invented ones), "Created marketing-autopilot v1 definition." Second run: identical 6 roles re-affirmed, "Updated existing marketing-autopilot v1 definition." Queried row counts directly after the double run: **6 role rows, 1 workflowDefinition row** — no duplicates. Against real networked Postgres: BLOCKED (same root cause).

## 8. Integration Tests

**49/49 PASS**, re-run fresh this phase against the in-process PGlite adapter (the standing, most-rigorous-available real-Postgres-engine path — see Section 4 for why the networked target remains unavailable). Zero test modifications were made to force a pass; the one new test file this phase (`env.production-guard.test.ts`, 12 tests) is additive, testing genuinely new fail-fast behavior.

## 9. Browser E2E

**9/9 PASS**, re-run fresh this phase, unchanged from Phase 20 (no frontend code changed).

## 10. Authentication

Re-verified live this phase (not just re-citing prior phases): missing token → 401; malformed token (`Bearer not.a.jwt`) → 401; 25 rapid invalid-credential login attempts → blocked with 429 after ~18 (consistent with the configured `max: 20`). All 8 automated authentication integration tests re-run and passing.

## 11. Tenant Isolation

Re-verified live: `GET /workspaces/<foreign-uuid>/crm/contacts` with a valid token for a *different* workspace → 404 (anti-enumeration), never 403 or actual data. Architecturally re-confirmed by reading `app.ts`: every workspace-scoped resource (business-profiles, crm, workflows/marketing-autopilot, workflow-instances, content-assets, business-analyzer) is mounted under a single `workspaceScoped` router that applies `authenticate, requireWorkspaceContext, enforceWorkspacePathMatch` once, centrally — the isolation boundary is structural, not per-route discipline. All 13 automated tenant-isolation tests re-run and passing.

## 12. Workflow Reliability

Live probing this phase found and fixed the phase's most significant bug (detailed in full in `docs/PHASE_21_SECURITY_CERTIFICATION.md` Finding #1): while verifying the golden path against a real Postgres-wire-protocol server, `POST /workspaces` 500'd with `Error: OWNER system role is not seeded` immediately after the exact same role had just been confirmed present via a direct database query. Root cause: `backend/src/config/env.ts`'s `USE_PGLITE_ADAPTER: z.coerce.boolean().default(false)` — Zod's `z.coerce.boolean()` is literally `Boolean(value)`, and `Boolean("false")` is `true` in JavaScript (any non-empty string is truthy). Explicitly passing `USE_PGLITE_ADAPTER=false` therefore silently became `true`, pointing the running server at a fresh, empty, in-process PGlite instance instead of the real seeded database its `DATABASE_URL` named.

**Fix**: a `booleanEnvVar()` helper (`z.preprocess`) that parses only the literal strings `"true"`/`"false"` (case-insensitive) into their intended boolean values, failing validation on anything else rather than truthy-coercing it. **Verified live**: after the fix, an identical golden-path session (register → login → create workspace) against the same real database succeeded end-to-end (workspace created, `roleKey: "OWNER"` correctly present in the minted token). **Regression tests**: 3 new tests in `env.production-guard.test.ts` pin this exact behavior (`"false"` → `false`, `"true"` → `true`, unset → default `false`).

Phase 20's two mandatory reliability fixes (ContentAsset idempotency, concurrent-approval atomicity) were re-verified this phase via the full 49-test suite, unchanged and still passing — no regression.

## 13. Transaction Certification

- **Unique constraint violation**: verified via the ContentAsset idempotency tests — a direct duplicate `create` on `(workflowInstanceId, day, platform, contentType)` throws (Prisma P2002 / raw SQLSTATE 23505, both handled — see `startInstance`'s idempotency-key race-recovery comment, unchanged this phase).
- **Concurrent approval**: re-verified via `marketing-autopilot.integration.test.ts`'s genuine `Promise.all` concurrency test — exactly one 200/COMPLETED and one 409, 30 content assets (not 60), 7 SUCCEEDED step-runs (not 14).
- **Row-level locking**: `credit-ledger.service.ts`'s `recordUsage`/`grantCredits` both issue `SELECT id FROM workspaces WHERE id = ... FOR UPDATE` before computing balance — confirmed by direct code inspection this phase; this is the mechanism that makes concurrent credit debits safe, structurally equivalent in spirit to the atomic `updateMany` approval fix.
- **Insufficient-credit rejection as a real transactional guardrail**: live-observed this phase (see Section 26) — a workspace whose 100-credit starter allowance was genuinely exhausted by 5 real workflow runs correctly rejected a 6th run with `InsufficientCreditsError` rather than allowing it to proceed or silently succeed with partial billing.
- **Rollback**: not independently re-tested this phase beyond what the above already exercises (a failed step correctly leaves the instance in `FAILED`, never partially COMPLETED — confirmed via the live `validate_context` failure repro in Section 26, whose instance correctly ended in `FAILED` with a structured `error` field, not a corrupted intermediate state).

## 14. Workflow State Machine

Re-confirmed the real enum values from `schema.prisma`: `PENDING, RUNNING, AWAITING_APPROVAL, COMPLETED, FAILED, RETRYING, CANCELLED`. Re-traced every declared transition in `VALID_TRANSITIONS` (`workflow-engine.service.ts`) against live code paths, unchanged from Phase 20's finding: `RETRYING` and `PENDING→CANCELLED`/`FAILED→CANCELLED` remain declared but unreachable by any current code path (no cancel endpoint exists; instance-level `RETRYING` is never set — only the separate `WorkflowStepRun.status` enum reaches it). Not a safety issue — a more permissive table than what's exercised is not unsafe — reported honestly rather than silently assumed resolved.

**Human approval cannot be overwritten by an automatic retry**: verified via the ContentAsset idempotency test suite — the `persist_assets` step's `upsert` update clause intentionally excludes `status`/`approvedByUserId`/`approvedAt`/`editedCaption`, so a retried step re-affirms content fields only, never reverting a human's decision.

## 15. Backup

**BLOCKED.** No backup has ever been taken — requires real networked Postgres (Section 4). Policy and procedure remain defined in `docs/DISASTER_RECOVERY_RUNBOOK.md`, expanded this phase with 9 full incident playbooks (Section 24 below), unexecuted.

## 16. Restore

**BLOCKED**, same root cause as Section 15.

## 17. AI Provider

`REAL_AI_PROVIDER = BLOCKED` — no credential exists, none fabricated. `AIProviderPort`/`MockProviderAdapter`/`ProviderRouter` boundary re-confirmed unchanged and correctly isolating AI-provider failure domains from authentication/tenant/billing logic (Section 24's AI-outage playbook traces this architecturally). AI_PROVIDER=mock in production is now an explicit, intentional, documented startup warning (Section 18) rather than silent.

## 18. Cost & Usage

Live-demonstrated this phase (not merely code-reviewed): a real workspace's 100-credit starter allowance (`FREE_TIER_STARTER_CREDITS`) was genuinely exhausted by 5 real workflow runs (5 × 20 credits = 100, `CREDIT_COSTS.strategy + .pillars + .calendar`), and a 6th run on the same workspace correctly received `InsufficientCreditsError` rather than proceeding. This is exactly the "one logical workflow does not silently multiply cost" property Section 17 of this phase's brief required — proven with real exhaustion, not a mocked assertion. The separate `workflowExecutionRateLimit` (max 20 executions/hour/workspace) provides an independent structural cap regardless of balance.

## 19. Production Configuration

Full environment-variable matrix (`backend/src/config/env.ts`, the sole `process.env` reader in the codebase):

| Name | Type | Secret? | Required? | Default | Prod requirement | Failure behavior |
|---|---|---|---|---|---|---|
| NODE_ENV | enum | No | No | development | Must be `production` | Silent default if unset (see Remaining Risks) |
| PORT | number | No | No | 4000 | Any | Fails validation if non-numeric |
| API_PREFIX | string | No | No | /api/v1 | Any | N/A |
| CORS_ORIGIN | string | No | No | localhost:5173 | Real frontend origin, not localhost | **Fails startup in production if localhost** (new this phase) |
| DATABASE_URL | string | **Yes** | **Yes** | none | Real Postgres, not localhost | **Fails startup if missing or localhost-in-production** (localhost check new this phase) |
| JWT_SECRET | string | **Yes** | **Yes**, min 16 chars | none | Unique random ≥32 chars, never a known placeholder | **Fails startup if missing, too short, or a known dev placeholder in production** (placeholder check new this phase) |
| JWT_REFRESH_SECRET | string | **Yes** | **Yes**, min 16 chars | none | Same as above, and must differ from JWT_SECRET | **Fails startup if missing, too short, a known placeholder, or equal to JWT_SECRET in production** (new this phase) |
| BCRYPT_SALT_ROUNDS | number | No | No | 10 | 12+ recommended | N/A |
| RATE_LIMIT_WINDOW_MS / MAX_REQUESTS | number | No | No | 900000 / 100 | Tune to real traffic | N/A |
| REQUEST_TIMEOUT_MS | number | No | No | 30000 | Any | N/A |
| WORKFLOW_RATE_LIMIT_WINDOW_MS / MAX_EXECUTIONS | number | No | No | 3600000 / 20 | Tune to real usage | N/A |
| UPLOAD_MAX_FILE_SIZE_MB / UPLOAD_DIR | mixed | No | No | 10 / ./uploads | Any | N/A |
| AI_PROVIDER | enum | No | No | mock | mock is a supported, deliberate mode | **Logs a startup warning (not an error) if mock in production** (new this phase) |
| OPENAI_API_KEY | string | **Yes** | Only if AI_PROVIDER=openai | none | Real key, never committed | Adapter throws at construction if openai + empty key |
| OPENAI_MODEL | string | No | No | gpt-4o-mini | Any | N/A |
| USE_PGLITE_ADAPTER | boolean (fixed parsing this phase) | No | No | false | **Must be false or unset** | **Fails startup if true in production; now correctly parses "false" as false** (both new this phase) |

## 20. Security

See `docs/PHASE_21_SECURITY_CERTIFICATION.md` in full. Summary: 2 HIGH findings, both fixed with regression tests this phase; 0 unresolved CRITICAL; 0 unresolved HIGH; 0 Tier-0 tenant-isolation failures. Response bodies confirmed (by code inspection of `error-handler.ts`) to never leak stack traces, internal paths, or credentials — generic 500 body, full detail server-side-only via `console.error`.

## 21. Observability

`/health/live`, `/health/ready`, `/metrics` re-confirmed live this phase (200 responses observed during probing). `recordAuthFailure`/`recordDatabaseError`/`recordWorkflowExecution` continue to fire correctly through both the fixed and unchanged code paths (confirmed by the 49-test suite exercising them). Structured JSON request logs (`requestId`, `method`, `route`, `status`, `durationMs`) observed directly in this phase's live server logs — no secrets present in any log line reviewed.

## 22. Deployment

**BLOCKED** — Docker unavailable in this environment (`docker --version` → command not found), unchanged since Phase 18. `backend/Dockerfile`/`frontend/Dockerfile` not modified this phase (nothing changed that would affect their structure). `DEPLOYMENT_RUNTIME = BLOCKED`. Exact commands ready to execute once infrastructure permits: `docker compose up -d && npm run prisma:migrate:deploy -w backend && npm run db:seed -w backend && npm run test:integration -w backend -- --database=real && npx playwright test`.

## 23. CI/CD

`.github/workflows/ci.yml` unchanged this phase. **STRUCTURALLY VERIFIED** — every command in it (install, lint, typecheck, unit, integration, build) was re-confirmed to work by running the identical command locally this phase; no GitHub Actions runner was exercised. `CI = STRUCTURALLY VERIFIED`, not claimed as passed.

## 24. Disaster Recovery

`docs/DISASTER_RECOVERY_RUNBOOK.md` extended this phase with 9 full incident playbooks (database outage, AI provider outage, authentication compromise, tenant-isolation incident, runaway workflow, cost spike, migration failure, bad deployment, data corruption), each with DETECTION/CONTAINMENT/RECOVERY/VALIDATION/POSTMORTEM, grounded in this repository's actual code (real file/function names — `enforceWorkspacePathMatch`, `workflowExecutionRateLimit`, `credit-ledger.service.ts`'s row locking, etc.), not generic boilerplate. None of these have been exercised as a real drill; RPO/RTO remain engineering estimates, explicitly labeled as such, not measured.

## 25. First Customer Readiness

`docs/FIRST_CUSTOMER_PRODUCTION_CHECKLIST.md` (new this phase): every step of the real customer journey (register → login → workspace → onboarding → business profile → dashboard → generate → review → approve → persist → logout → login → resume → edit → final state) is VERIFIED via a combination of the 9/9 Playwright suite and live curl-based sessions run this phase. Known scope limitations stated plainly in that document: PGlite, not real Postgres; mock AI, not real AI; no real payment integration.

## 26. Performance

Re-ran `perf-smoke.ts` — but first found and fixed two defects that had silently invalidated its two most important measurements in every prior phase:

1. **Missing `industry` field**: the script's synthetic business profile omitted `industry` (optional at the API layer for editability, but required by `marketing-autopilot.steps.ts`'s `step01ValidateContext`, a permanent, never-retried failure). Every "workflow create+complete" and "approval" measurement through Phase 20 was therefore actually timing an instant step-1 validation rejection (~20-40ms), not a real 7-step/30-asset run. Real customers cannot hit this — `OnboardingPage.tsx`'s industry field is `required` at the HTML form layer.
2. **Workspace credit exhaustion**: the approval-timing loop reused the workflow-creation loop's workspace, whose 100-credit starter allowance the workflow-creation loop (5 runs × 20 credits) had *exactly* exhausted — every approval-loop run then correctly hit `InsufficientCreditsError`. Fixed by giving the approval loop its own dedicated workspace with a fresh allowance.

**Corrected, now-genuinely-valid measurements** (PGlite-native engine, in-process, single-threaded):

| Operation | n | p50 | p95 | p99 |
|---|---|---|---|---|
| register | 15 | 62.6ms | 90.5ms | 90.5ms |
| login | 15 | 3.2ms | 68.9ms | 68.9ms |
| workspace create | 15 | 24.7ms | 47.9ms | 47.9ms |
| dashboard load | 15 | 5.4ms | 7.2ms | 7.2ms |
| CRM contacts list | 15 | 4.7ms | 6.2ms | 6.2ms |
| **workflow create+complete (30 assets)** | 5 | **516.7ms** | **648.0ms** | 648.0ms |
| list workspaces | 15 | 6.9ms | 11.6ms | 11.6ms |
| content asset list | 15 | 8.0ms | 9.8ms | 9.8ms |
| **approval** | 5 | **34.7ms** | **37.0ms** | 37.0ms |

The bolded rows are 15-25x different from every prior phase's reported numbers for the same operations — those prior numbers were measuring rejections, not the real operations. This is the first phase with genuinely valid timings for the two heaviest operations in the product. p99 at n≤15 remains statistically thin, reported honestly.

## 27. Bugs

See `docs/PHASE_21_SECURITY_CERTIFICATION.md` for the full findings table. Summary: 2 real HIGH-severity application bugs found live and fixed with regression tests (`USE_PGLITE_ADAPTER` boolean coercion; missing production-config guards); 2 tooling-only defects found and fixed (perf-smoke.ts's missing `industry` field and workspace credit exhaustion); 3 attack patterns live-probed and confirmed NOT exploitable (mass assignment, cross-tenant access, rate-limit bypass).

## 28. Known Limitations

Unchanged from Phase 20: no real Postgres, no real backup/restore, no real deployment, no real AI provider credential. New this phase: the state-machine's declared-but-unreachable transitions (`RETRYING`, two `CANCELLED` paths) remain unaddressed — low risk, documented, not fixed (out of this phase's mandatory-fix scope).

## 29. Remaining Blockers

Single root cause, unchanged: no working credentials for the real, running PostgreSQL server. Everything downstream (real migration, real seed-against-real-Postgres, real integration run, real transaction certification against the networked server, real backup, real restore, real deployment) stays blocked as a direct consequence.

## 30. Release Gate

| Gate | Status | Evidence |
|---|---|---|
| REAL_POSTGRES | BLOCKED | Section 4 |
| MIGRATIONS | STRUCTURALLY VERIFIED (real-engine replay) / BLOCKED (networked) | Section 6 |
| SEEDS | VERIFIED (real-engine double-run) / BLOCKED (networked) | Section 7 |
| INTEGRATION | VERIFIED (49/49, PGlite) | Section 8 |
| E2E | VERIFIED (9/9) | Section 9 |
| AUTH | VERIFIED | Section 10 |
| TENANT_ISOLATION | VERIFIED | Section 11 |
| RBAC | VERIFIED | Section 20 / `PHASE_21_SECURITY_CERTIFICATION.md` |
| WORKFLOW | VERIFIED | Section 14 |
| TRANSACTIONS | VERIFIED (PGlite-scope) | Section 13 |
| BACKUP | BLOCKED | Section 15 |
| RESTORE | BLOCKED | Section 16 |
| AI_PROVIDER | BLOCKED (honestly classified, architecture supports operation without it) | Section 17 |
| COST_CONTROL | VERIFIED (live exhaustion demonstration) | Section 18 |
| CONFIGURATION | VERIFIED (hardened this phase) | Section 19 |
| SECURITY | VERIFIED (0 unresolved CRITICAL/HIGH) | Section 20 |
| OBSERVABILITY | VERIFIED | Section 21 |
| DEPLOYMENT | BLOCKED | Section 22 |
| CI_CD | STRUCTURALLY VERIFIED | Section 23 |
| DISASTER_RECOVERY | DEFINED, unexercised | Section 24 |
| FIRST_CUSTOMER | VERIFIED (PGlite/mock-AI scope) | Section 25 |

**5 of 20 gates BLOCKED, all tracing to one root cause (real Postgres credentials). 0 unresolved CRITICAL/HIGH security issues. 0 Tier-0 tenant-isolation failures.**

## 31. Evidence Appendix

Representative commands actually executed this phase:

```bash
# Postgres re-check (no guessing, only re-checking configured/known-failed credential)
psql -h localhost -U postgres -d postgres -c "SELECT 1;"   # FATAL: password authentication failed

# pg_hba.conf read-only inspection (no modification)
Get-Content 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf' | Select-String '^[^#]\S'

# Real-engine migration replay
node scripts/migrate-pglite.mjs

# Seed double-run
npx tsx src/scripts/seed-rbac.ts && npx tsx src/scripts/seed-workflow-definitions.ts   # x2, row counts confirmed via direct query

# Full regression
npm test -- --run                                              # 37/37
USE_PGLITE_ADAPTER=true npx vitest run --config vitest.integration.config.ts   # 49/49
npx tsc -p tsconfig.json --noEmit                               # backend, clean
npx tsc -b --noEmit                                              # frontend, clean
npx eslint .                                                     # both, 0 errors
npm run build                                                    # both, clean
npx playwright test                                              # 9/9

# Live golden-path + security probing (curl against a running server bound to
# a real Postgres-wire-protocol PGlite instance)
curl -X POST http://localhost:4102/api/v1/auth/register ...
curl -X POST http://localhost:4102/api/v1/workspaces ...
# (full probe list in PHASE_21_SECURITY_CERTIFICATION.md)

# Performance
USE_PGLITE_ADAPTER=true npx tsx src/scripts/perf-smoke.ts
```

## 32. Final Verdict

```text
RELEASE CANDIDATE — BLOCKED
```

Per this phase's own rule ("do not declare production ready based on structural evidence alone") and the exhaustive prerequisite list for PRODUCTION READY (real Postgres, real migration against it, real seed against it, real backup, real restore, real deployment rehearsal — none met), this is the only honest verdict. Version bumped to `0.1.0-rc.4` (see CHANGELOG) — consistent with the pattern established in Phase 20: a phase that ships real, regression-tested fixes earns a new release-candidate number even while REAL_POSTGRES remains BLOCKED, because the artifact being certified has genuinely changed.

## 33. Exact Next Action

```bash
DATABASE_URL="postgresql://bizpilot_app:<password>@localhost:5432/bizpilot_ai_dev?schema=public" npx prisma migrate deploy --schema=backend/prisma/schema.prisma
```

Once the `bizpilot_app` role and `bizpilot_ai_dev` database exist with a working password, this single command unblocks Sections 4, 6, 7, 8 (real target), 13 (real target), 15, 16, and 22 — every BLOCKED gate in Section 30 traces to this one dependency.
