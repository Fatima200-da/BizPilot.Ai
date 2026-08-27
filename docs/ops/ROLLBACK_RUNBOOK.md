# Rollback Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** reverting a deployment that turned out to be broken. Read [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) first — this document assumes that one's steps were followed.

## First decide: is this an application rollback, a migration rollback, or both?

These are genuinely different operations with different risk profiles. An application-code-only rollback (redeploy the previous build artifact, no schema change involved) is low-risk and should usually be the first thing tried. A migration rollback (reverting a real schema change) is higher-risk and is only needed if the NEW migration itself is the problem — most of the time, rolling back application code while LEAVING a backward-compatible migration in place is sufficient and safer.

## Application rollback (no schema change involved, or the new migration is backward-compatible)

1. Redeploy the previous known-good build artifact (previous `backend/dist/` + `frontend/dist/`, or your platform's equivalent "redeploy previous release" action).
2. Follow `DEPLOYMENT_RUNBOOK.md`'s readiness/health verification steps (`/health/live`, `/health/ready`, smoke test) against the ROLLED-BACK version before cutting traffic to it.
3. Confirm `GET /admin/alerts` clears the alert(s) that triggered the rollback within a reasonable window. If it doesn't, the problem may not have been the application code — reconsider whether this is actually a database/dependency/infrastructure incident instead (see `INCIDENT_RESPONSE_RUNBOOK.md`'s routing).

## Migration rollback

**Prisma's `migrate deploy` has no automatic "undo" command** — a migration, once applied, is reverted by writing and applying a new, real, forward migration that reverses the schema change, OR by manually reverting via `DROP`/`ALTER` statements and removing the migration's row from `_prisma_migrations` (only appropriate immediately after a bad deploy, before any real production data depends on the new schema shape).

### Backward-compatible migrations (the goal for every migration, always)

A backward-compatible migration is one where the OLD application code can still run correctly against the NEW schema — e.g. adding a new nullable column, adding a new table, adding a new index. This is why every migration in this project should be written additive-first: it means an application rollback (above) is always safe even if the migration stays applied, which is the fast, low-risk path. This project's own migration history (Phase 33's `data_retention_schedules`, `password_reset_tokens`, `data_export_runs` additions) follows this pattern — pure new tables, no altered/dropped columns on existing tables — and was rehearsed via a real forward → `DROP TABLE` rollback → forward re-apply cycle to confirm clean reversibility before shipping.

### Non-backward-compatible migrations (column drops, type changes, renames)

These require the schema rollback to happen BEFORE or ATOMICALLY WITH the application rollback — running old application code against a schema that already dropped a column it expects will error immediately. If you must ship one of these:
1. Prefer a real two-step deploy instead of a single risky migration: (a) deploy application code that stops USING the old column/shape while the column still exists, (b) only in a LATER deploy, once (a) has been running successfully for a while, drop the now-truly-unused column in its own migration. This means a rollback of step (b) is trivial (nothing depended on the drop yet) and a rollback of step (a) doesn't need a schema change at all.
2. If a non-backward-compatible migration must ship in one step anyway, write and rehearse its real reverse migration BEFORE deploying the forward one — confirm both directions against a staging/copy database, using the same forward → rollback → forward rehearsal technique already established for this project's migrations.

## Data-loss risk during rollback

**Rolling back a migration that already has real production data in a new/changed column loses that data** if the rollback drops the column — this is unavoidable, not a bug in the rollback procedure. Before rolling back a migration that's been live for more than a few minutes, check whether any real data has already been written into whatever it added; if so, decide explicitly (not by default) whether preserving that data (via a real backup restore into an isolated schema for retrieval later, per `RESTORE_RUNBOOK.md`) matters before proceeding.

## After a rollback

1. Same health/readiness verification as any deployment (`DEPLOYMENT_RUNBOOK.md`).
2. Confirm data integrity for anything the failed forward deploy touched — a real spot-check of the affected tables/rows, not just "the app looks fine."
3. Write the postmortem (`INCIDENT_RESPONSE_RUNBOOK.md`) — a rollback is itself evidence of a gap in the pre-deployment checklist (a test that should have caught this didn't); the postmortem should identify what real regression test or rehearsal step would have caught it before it shipped.
