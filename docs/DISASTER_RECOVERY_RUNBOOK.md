# Disaster Recovery Runbook

## Honest status up front

**No backup has ever been taken. No restore has ever been executed. `RESTORE_TEST = BLOCKED`.**

This is not a gap this phase could close: taking and restoring a real backup requires a real, networked, credentialed PostgreSQL server, which has been unavailable across Phases 16–19 (a real server exists in this environment as of Phase 18, but working credentials for it were never obtained — see the main Phase 19 record doc, Section D). Everything below is a **policy and procedure**, written so it is ready to execute the moment that blocker clears — it is explicitly not a claim that recoverability has been proven.

## Backup policy (defined, not yet executed)

- **What**: a full `pg_dump` (custom format, `-Fc`) of the production database, taken on a schedule.
- **Frequency**: daily full backup, retained 30 days; the schema is small (43 models) and data volume is expected to be low pre-first-customer, so this is deliberately simple rather than incremental/WAL-based — revisit once real usage data exists.
- **Storage**: off the database host, in a separate failure domain (object storage, not a second disk on the same machine) — not yet provisioned (DEFERRED, tracked as a real infrastructure gap, not silently assumed to exist).
- **Encryption**: backups must be encrypted at rest — not yet implemented (DEFERRED, blocked on the same missing infrastructure).

## Restore procedure (defined, not yet executed)

```bash
# 1. Provision a fresh Postgres instance (or a scratch database on an
#    existing server) — never restore over the live production database
#    as the first step of a test.
createdb bizpilot_ai_restore_test

# 2. Restore from the most recent backup.
pg_restore --dbname=bizpilot_ai_restore_test --clean --if-exists /path/to/backup.dump

# 3. Verify structural integrity.
psql bizpilot_ai_restore_test -c "\dt" # expect 43 tables
psql bizpilot_ai_restore_test -c "SELECT count(*) FROM \"User\";"
psql bizpilot_ai_restore_test -c "SELECT count(*) FROM \"Workspace\";"

# 4. Point a scratch instance of the application at the restored database
#    and run the golden-path Playwright suite against it — a restore that
#    "looks structurally fine" but breaks the actual application is not a
#    successful restore.
DATABASE_URL=postgresql://.../bizpilot_ai_restore_test npx playwright test
```

**This procedure has never been executed.** Do not treat the steps above as evidence of recoverability — they are the plan, not the proof.

## RPO / RTO (targets, not measured — no incident or drill has ever occurred)

| | Target | Basis |
|---|---|---|
| RPO (Recovery Point Objective) | ≤24 hours | Matches the defined daily backup frequency — real data loss window would be "up to one day's worth of writes" given the policy above, once implemented |
| RTO (Recovery Time Objective) | ≤2 hours | Estimate based on: provision a fresh Postgres instance + `pg_restore` (schema this size, expected low data volume) + redeploy application pointed at it. **Not measured against a real restore** — this is an engineering estimate, labeled as such, not a tested SLA |

## Disaster scenarios and current readiness

| Scenario | Readiness | Evidence |
|---|---|---|
| Database corruption / accidental data deletion | BLOCKED | No backup exists to restore from |
| Application process crash | VERIFIED (partial) | `server.ts`'s `uncaughtException`/`unhandledRejection` handlers (added Phase 19) trigger a clean shutdown rather than continuing in a corrupted state; a process manager (systemd/Docker `restart: always`) would then restart it — restart behavior itself untested against a real deployment |
| Database temporarily unreachable | VERIFIED | `/health/ready` correctly reports 503; the application does not crash, it degrades to reporting unhealthy (re-verified live this phase against a genuinely unreachable address) |
| Full infrastructure loss (host/region failure) | BLOCKED | No infrastructure exists to lose in a recoverable way — nothing has ever been deployed outside this local development environment |
| Migration applied incorrectly in production | Partially mitigated by policy | See the Expand/Migrate/Verify/Contract policy in `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`'s migration-policy section — never executed against a real server |

## Incident playbooks (Phase 21 Section 23)

Each entry below is DETECTION → CONTAINMENT → RECOVERY → VALIDATION → POSTMORTEM. Written against this repository's actual code (file/function names, not invented ones); none of these have been exercised as a real drill — they are the plan, evidenced only where explicitly marked VERIFIED.

### 1. Database outage
- **Detection**: `/health/ready` returns 503 (`readyHandler`, `modules/health/health.controller.ts`) — re-verified live this phase against a genuinely unreachable address. `recordDatabaseError()` increments the Prisma-error metric (`common/observability/metrics.ts`).
- **Containment**: `requestTimeout` (Phase 19, `REQUEST_TIMEOUT_MS`, default 30s) prevents a stalled DB connection from holding requests open indefinitely; the process itself stays up and reports unhealthy rather than crashing.
- **Recovery**: restore database connectivity (network/credentials/service); no application redeploy needed — Prisma reconnects on the next query once the server is reachable.
- **Validation**: `/health/ready` returns 200 again; run the Playwright golden path once more.
- **Postmortem**: was the outage caused by a credential rotation, host failure, or network partition? Feed the answer back into the monitoring/alerting gap it exposed.

### 2. AI provider outage
- **Detection**: `AIProviderPort` calls fail/timeout; `recordAiRequest` (metrics.ts) would show a spike in failed calls once wired to a real provider (currently always `mock`, which cannot itself go down).
- **Containment**: the AI Provider Abstraction (`infrastructure/ai/`) means a provider outage is isolated to workflow-execution steps — it cannot affect authentication, CRM, or any non-AI read/write path, by architecture, not by incident response.
- **Recovery**: switch `AI_PROVIDER` back to `mock` (already the fail-safe default) to keep the product operable in a degraded (non-AI) mode while the real provider recovers, or wait for the provider's own recovery.
- **Validation**: a workflow run started after recovery completes successfully end-to-end.
- **Postmortem**: was retry/backoff sufficient, or did it amplify load on a struggling provider? (Phase 19's resilience testing covered timeout/transient-failure handling structurally; no real-provider outage has ever been observed.)

### 3. Authentication compromise (e.g. a leaked JWT_SECRET)
- **Detection**: unexpected `isSystemAdmin: true` claims or tokens for users who never registered; a spike in `recordAuthFailure()` from repeated invalid-signature attempts.
- **Containment**: rotate `JWT_SECRET`/`JWT_REFRESH_SECRET` immediately — every existing access/refresh token becomes invalid the instant the signing key changes, forcing a full re-login for every user (blunt but immediate).
- **Recovery**: deploy with the new secret; the Phase 21 `env.ts` production guard now fails startup if the new secret equals a known dev placeholder or matches the compromised value's known bad patterns.
- **Validation**: confirm old tokens are rejected (`AuthTokenInvalidError`) and fresh logins succeed.
- **Postmortem**: how did the secret leak (repo commit, log line, misconfigured error response)? The error handler (`common/middlewares/error-handler.ts`) never returns secrets in a response body — re-verify that invariant holds after the fix.

### 4. Tenant isolation incident (cross-workspace data exposure)
- **Detection**: any report or log pattern showing one workspace's data served under another workspace's auth context — would show up as an unexpected `enforceWorkspacePathMatch` bypass, since that single middleware (`common/middlewares/auth.ts`) is the sole tenant boundary for every workspace-scoped router (`app.ts`'s single `workspaceScoped` mount).
- **Containment**: because tenant isolation is enforced at one centralized mount point rather than per-route, a fix there closes the gap for every resource simultaneously — take the affected route(s) offline (feature-flag or reverse-proxy block) only if the centralized fix cannot ship immediately.
- **Recovery**: patch the specific query/middleware gap, add a regression test reproducing the exact leaked resource type, redeploy.
- **Validation**: re-run the full tenant-isolation test suite (13 tests as of Phase 19/20/21) plus a new test for the specific leak pattern found.
- **Postmortem**: this is a Tier-0 incident — full audit of every workspace-scoped query added since the last clean audit, not just the one that leaked.

### 5. Runaway workflow execution
- **Detection**: `workflowExecutionRateLimit` (`common/middlewares/rate-limit.ts`, keyed by `workspaceId`) returns 429 once a workspace exceeds `WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS` (default 20/hour) — this is the primary automatic containment, not just a detection signal.
- **Containment**: the rate limit itself stops the runaway pattern within its window; for a true runaway (e.g. a client-side retry loop bypassing normal UX), temporarily lower `WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS` for that workspace via redeploy/config.
- **Recovery**: identify and fix the root cause (client bug, automation script, or a genuine workflow-engine bug producing repeated runs); restore the normal rate limit.
- **Validation**: workspace's execution rate returns to baseline; `/metrics` workflow counters confirm no further anomalous spike.
- **Postmortem**: was this abuse, a client bug, or a workflow-engine defect (e.g. a retry that doesn't respect the already-terminal state)?

### 6. Cost spike (AI/credit usage)
- **Detection**: `credit-ledger.service.ts`'s balance draining faster than expected for a workspace; the same `workflowExecutionRateLimit` above is the structural cap on how many billable runs are even possible per hour, independent of balance.
- **Containment**: the credit ledger (row-locked via `SELECT ... FOR UPDATE`, Section 6 below) hard-blocks any workflow run once a workspace's balance is exhausted — this is automatic, not manual containment.
- **Recovery**: if the spike was a pricing/metering bug (over-charging) rather than genuine usage, credit the affected workspace(s) and fix the metering logic; add a regression test for the exact miscalculation.
- **Validation**: `getBalance()` matches expected value for affected workspaces after correction.
- **Postmortem**: was the guardrail (rate limit + credit block) sufficient, or did this incident reveal a gap in it?

### 7. Migration failure in production
- **Detection**: `prisma migrate deploy` exits non-zero, or `prisma migrate status` shows a failed/partial migration.
- **Containment**: do not run further migrations against the same database until the failure is understood — a half-applied migration is the single highest-risk state to compound.
- **Recovery**: per the Expand/Migrate/Verify/Contract policy (`docs/PRODUCTION_RELEASE_RUNBOOK.md`), a rollback-safe (additive) migration can simply be left as-is if harmless, or manually reverted with a hand-written down-migration; a rollback-risky migration requires the documented rollback-risk classification made *before* the release to know what's safe.
- **Validation**: `prisma migrate status` shows a clean, fully-applied history; run the integration suite against the now-migrated database.
- **Postmortem**: why did staging/rehearsal not catch this? (Honest answer as of Phase 21: there has never been a real staging environment with real Postgres to rehearse against — this is the standing root-cause blocker, not a process failure unique to this incident.)

### 8. Bad deployment
- **Detection**: `/health/live` or `/health/ready` failing post-deploy, or an elevated error rate in `/metrics`.
- **Containment/Recovery**: application rollback (redeploy the immediately-prior image) per `docs/PRODUCTION_RELEASE_RUNBOOK.md`'s three-layer rollback model — the default, preferred path unless a rollback-risky migration shipped in between.
- **Validation**: health checks green, error rate back to baseline, golden-path E2E passes against the rolled-back version.
- **Postmortem**: what did CI/CD (`.github/workflows/ci.yml`) fail to catch that a real deployment exposed? (As of Phase 21, CI is STRUCTURALLY VERIFIED only — no real deployment has ever exercised these deploy jobs, so this playbook is unproven in practice.)

### 9. Data corruption
- **Detection**: application-level invariant violations (e.g. a `ContentAsset` referencing a nonexistent `WorkflowInstance`), or a failed foreign-key/unique-constraint check surfacing where one shouldn't be possible given the schema's own constraints.
- **Containment**: stop writes to the affected table/workspace if corruption is actively spreading (application-level feature flag, since there is no infrastructure-level traffic control available in this environment).
- **Recovery**: restore from the most recent clean backup (see Restore procedure above) — this playbook is **BLOCKED** on the same standing dependency as every other backup-reliant recovery path: no backup has ever been taken.
- **Validation**: representative queries against the restored data match expected application invariants.
- **Postmortem**: was this caused by an application bug (missing transaction boundary) or an infrastructure fault? Phase 20/21's transaction-boundary work (atomic `updateMany` approval transitions, row-locked credit-ledger writes) specifically targets the application-bug class of this risk.

## What would make this real

1. A real, credentialed, networked PostgreSQL server (the standing blocker across four phases).
2. Object storage (or equivalent) in a separate failure domain from the database host.
3. One actual `pg_dump` → `pg_restore` cycle, executed and its exact output recorded here, replacing every "not yet executed" above with a dated, evidenced entry.
