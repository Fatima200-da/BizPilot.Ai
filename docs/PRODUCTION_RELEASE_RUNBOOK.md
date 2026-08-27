# Production Release Runbook

## Release process

Every release has: a version (`VERSION`, SemVer + `-rc.N` pre-release suffix until the first stable release), a commit SHA, a recorded migration state, test evidence (exact commands + pass/fail counts, not narrative claims), a build artifact, release notes (`CHANGELOG.md`), and an explicit rollback plan (below).

```
Release Candidate cut
   → automated verification (CI: typecheck, lint, unit, integration, E2E, build — see .github/workflows/ci.yml)
   → staging deployment + smoke test (BLOCKED — no staging infrastructure provisioned, Section 23 of the Phase 19 record doc)
   → manual production-approval gate (GitHub Environment "production" with required reviewers — configured in CI, never an automatic deploy from a branch push)
   → production deployment
   → post-deploy verification (health checks + golden-path smoke test against the live URL)
   → rollback if verification fails
```

**Current state**: this repository has cut one release candidate (`0.1.0-rc.1`, Phase 18) and is preparing this phase's evidence toward the next. No staging or production deployment has ever occurred — the process above is fully defined and CI-automated up through the artifact-build stage; everything from "staging deployment" onward is real, working procedure with no infrastructure to run it against yet.

## Migration policy

**Never `DROP` → hope.** Every schema change with any data-loss potential follows Expand → Migrate → Verify → Contract:

1. **Expand**: add the new column/table/constraint in a backward-compatible way (nullable column, new table, additive index) — the *old* application code must keep working against the *new* schema.
2. **Migrate**: deploy application code that writes to both old and new shapes (or backfills the new shape), then backfill existing rows.
3. **Verify**: confirm the new shape is fully populated and correct (row counts, spot checks) before anything depends on it exclusively.
4. **Contract**: only after Verify passes, remove the old column/constraint in a separate, later migration.

This repository has exactly one migration to date (`20260808194414_init`) — the *initial* schema, which has no prior state to migrate from and so does not exercise this policy. **The policy has never been exercised against a real schema change** — this is the defined procedure for the next one, not a claim of a proven track record.

### Migration risk classification (applied per-migration, going forward)

| Risk class | Definition | Rollback strategy |
|---|---|---|
| Rollback-safe | Purely additive (new nullable column, new table, new index) | `prisma migrate resolve` / re-deploy the prior application version; the additive change is inert to old code |
| Rollback-risky | Renames, type changes, or NOT NULL additions without a default | Requires the Expand/Contract split above; a naive rollback of application code alone would break against the new schema |
| Rollback-impossible | Any `DROP COLUMN`/`DROP TABLE` that already ran and whose data was not preserved elsewhere | Restore from backup is the only path (see `docs/DISASTER_RECOVERY_RUNBOOK.md` — currently BLOCKED) |

## Rollback engineering — three layers

1. **Application rollback**: redeploy the immediately-prior container image/build artifact. Safe by default as long as no rollback-risky or rollback-impossible migration shipped in between — this is why every release's migration risk classification (above) must be recorded, not inferred after the fact.
2. **Database-compatible rollback**: when a rollback-risky migration shipped, the *prior* application version must still be deployable against the *new* schema (this is exactly what the Expand step guarantees) — rolling back application code without also rolling back the schema is the default, preferred path; rolling back the schema itself is a last resort.
3. **Full incident recovery**: when neither of the above is sufficient (data corruption, a rollback-impossible migration already ran, or infrastructure failure) — see `docs/DISASTER_RECOVERY_RUNBOOK.md`. This is the only layer that depends on backups, which is why its current status (BLOCKED, no backup has ever been taken) is the single most important open item in this document.

**Every release must explicitly classify its own changes** as rollback-safe, rollback-risky, or rollback-impossible before deployment — this is a release-gate checklist item (see the main Phase 19 record doc's release gate), not an afterthought performed during an incident.

## Forward-fix scenarios

Not every failure should trigger a rollback. A rollback-impossible migration that already ran, or a bug whose fix is smaller and safer than reverting several dependent releases, should be forward-fixed (ship a new, small, targeted release) rather than rolled back. The release engineer's judgment call each time: **is reverting actually safer than fixing forward?** — for a rollback-impossible migration, reverting is not even available as an option, so forward-fix is the only path.

## Evidence this phase (Phase 19)

- 25/25 unit tests, 44/44 integration tests (up from 40 at the end of Phase 18), 9/9 Playwright E2E tests (up from 8) — all re-verified passing after every substantive change this phase (no-regression rule, Section 35 of this phase's brief).
- Both `npm run build` (backend, frontend) succeed, producing the exact artifacts `backend/Dockerfile` and `frontend/Dockerfile` reference.
- `npx prisma validate` passes.
- CI pipeline defined end-to-end (`.github/workflows/ci.yml`) through artifact build; staging/production deploy jobs are present but intentionally fail closed with an explicit "no infrastructure provisioned" message rather than pretending to deploy.

## Evidence update (Phase 20)

- 25/25 unit, **49/49 integration tests** (up from 44), 9/9 Playwright E2E — unchanged pipeline, re-verified after both mandatory reliability fixes (see `docs/PHASE_20_PRODUCTION_CERTIFICATION.md` Section 12).
- New migration `20260809160000_content_asset_domain_identity` adds `@@unique([workflowInstanceId, day, platform, contentType])` on `content_assets` — this is a rollback-safe (additive, index-only) migration under the Expand/Contract model above: it does not remove or rename any column, so the prior application version remains deployable against the new schema unchanged.
- The `approveInstance`/`rejectInstance` rewrite (atomic `updateMany` instead of find-then-update) is application-code-only, no schema change — a plain application rollback (layer 1 above) fully covers it if ever needed.
- Real Postgres migration/backup/restore/deployment status is unchanged from Phase 19 (still BLOCKED on credentials) — this phase's evidence does not alter any of those statuses.

## Evidence update (Phase 21)

- 37/37 unit (up from 25 — 12 new tests), 49/49 integration, 9/9 Playwright E2E — full regression re-run fresh this phase, no drift.
- Both fixes this phase (`env.ts`'s boolean-coercion bug and its new production-config guards) are application-code-only, no schema change — rollback-safe under layer 1 (application rollback) of the model above; no new migration shipped.
- The new production-config guards are themselves a rollback-safety improvement: a bad future deploy that accidentally ships a localhost `CORS_ORIGIN`/`DATABASE_URL` or a dev-placeholder JWT secret in production now fails fast at startup instead of silently running — this converts a class of "bad deployment" incidents (see the expanded `docs/DISASTER_RECOVERY_RUNBOOK.md`) into an immediate, loud failure rather than a slow-burning one.
- Version bumped to `0.1.0-rc.4` per this phase's certification doc — see `docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md`.

## Evidence update (Phase 22) — REAL_POSTGRES is no longer BLOCKED

- Real, credentialed, networked PostgreSQL 18 access obtained (least-privilege `bizpilot_app` role, `bizpilot_ai_dev` database). Real `prisma migrate deploy` executed cleanly; 44 tables, 39 enums, 100 FKs, 149 indexes structurally verified via direct system-catalog queries.
- 41/41 unit, **49/49 integration, 9/9 Playwright E2E — all now passing against the real networked server**, not PGlite. No test was weakened or rewritten to force a pass.
- Real transaction/concurrency/credit-ledger/rollback behavior proven with live requests and direct SQL verification against real Postgres — see `docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md` Section 10.
- **Real backup and restore executed for the first time**: a genuine `pg_dump` (192KB, custom format) and a genuine restore (into an isolated schema, since the least-privilege role correctly lacks `CREATEDB`) verified row-for-row across all 44 tables. `backups/` is gitignored; the dump is never committed.
- This closes 3 of the 4 layers in `docs/DISASTER_RECOVERY_RUNBOOK.md`'s "What would make this real" checklist (real Postgres, one full pg_dump→restore cycle, evidenced) — only off-host encrypted backup storage remains DEFERRED.
- Remaining gaps are environment/credential-only, not defects: Docker unavailable in this environment (deployment rehearsal blocked), no real AI provider credential. Version bumped to `0.1.0-rc.5`. Release verdict upgraded to **RELEASE CANDIDATE — MINOR BLOCKERS** — see `docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md`.
