# Disaster Recovery Runbook

**Audience:** whoever operates BizPilot.Ai in production, during an actual incident. **Scope:** what to do when data is lost, corrupted, or a database is unreachable — not routine backup/restore (see the other two runbooks for that).

## RPO / RTO — what to actually expect

- **RTO (Recovery Time Objective):** measured, real, current-data-volume restore times are in `docs/PHASE_31_DISASTER_RECOVERY_PRODUCTION_OPERATIONS_CERTIFICATION.md` (baseline) and re-confirmed in `docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md` — read whichever is more recent for exact current numbers before quoting an RTO to anyone (a founder, a customer, an SLA). RTO grows with real data volume; re-measure periodically, don't assume the certified number holds forever.
- **RPO (Recovery Point Objective):** bounded by how often backups actually run. With the daily schedule at `BACKUP_SCHEDULE_TIME` (default 03:00 UTC), the real worst-case RPO is **just under 24 hours** (data written between the last successful backup and the moment of loss is gone). If backups have been failing (`GET /admin/backups` shows `consecutiveFailures > 0` or `UNHEALTHY`, or a real `backup_failure`/`stale_backup` alert from `GET /admin/alerts` — see Phase 33's alerting system), the real RPO is however old the LAST successful backup actually was — check `lastSuccessful.startedAt`, don't assume 24h.
- **Restore-verification is automated, not just a manual drill claim.** As of Phase 32, every successful backup is automatically restored into a real isolated schema and verified immediately after it's written (`BackupRun.restoreVerifiedOk`) — a `restore_verification_failure` alert fires if that check itself fails. This gives continuous, evidence-based confidence that the LATEST backup is genuinely restorable, not just self-consistent, without waiting for an incident to find out.

## Decision tree

```
Is the database reachable at all?
├─ NO  → "Database instance lost" below
└─ YES → Is the data present but wrong/corrupted/missing rows?
         ├─ YES → "Data corruption" below
         └─ NO  → this isn't a data-loss incident — see general incident response
```

## Scenario: database instance lost entirely

1. Provision a fresh Postgres instance.
2. Point `DATABASE_URL` at it. Run `npx prisma migrate deploy` — recreates the full real schema (every table, index, constraint).
3. Follow `docs/ops/RESTORE_RUNBOOK.md`'s "Restoring into a genuinely NEW database" section, restoring the most recent `SUCCEEDED` `BackupRun` into the new `public` schema.
4. Verify before cutting traffic over: `GET /health/ready` on the app pointed at the new database must report `database: reachable`, and spot-check real row counts against what you expect.
5. Cut traffic over. Document the real incident timeline (when lost, when detected, when restored, real data-loss window) — this IS your real, measured RPO for this specific incident, not the target from this document.

## Scenario: data corruption (database reachable, data wrong)

1. **Do not restore over `public` directly as a first move.** Restore the most recent `SUCCEEDED` backup into an ISOLATED schema first (`docs/ops/RESTORE_RUNBOOK.md`) and compare it against the live `public` data to understand the actual scope of corruption before deciding what to do.
2. If the corruption is scoped to specific rows/tables, a targeted `INSERT`/`UPDATE` from the isolated restored schema back into `public` for exactly the affected rows is safer than a full-database restore (which would also discard legitimate writes made since the backup).
3. If the corruption is broad enough that a full restore is the right call, that is a judgment call requiring sign-off — this is a "genuinely irreversible relative to current state" action; follow `docs/ops/INCIDENT_RESPONSE_RUNBOOK.md`'s escalation procedure before proceeding.

## Scenario: backups themselves are failing

1. `GET /admin/backups` — check `lastFailed.errorMessage` for the real, structured reason.
2. Common real causes and what they mean:
   - **`BackupAlreadyInProgressError`**: another real backup is genuinely running, or a crashed process left a stale `RUNNING` row that hasn't yet aged past `BACKUP_STALE_RUNNING_MINUTES` — wait, or manually mark it `FAILED` if you're certain it's abandoned.
   - **A filesystem error (`ENOENT`, `EACCES`, `ENOSPC`)**: `BACKUP_DIR` doesn't exist, isn't writable, or the disk is full. Fix the underlying disk/permission issue, then trigger a manual backup (`POST /admin/backups/trigger`) to confirm recovery.
   - **A Postgres connection error**: the database itself is degraded — this is a database-availability incident, not a backup-specific one; see the Failure Matrix work from Phase 30 for that class of incident.
3. Once fixed, trigger a manual backup and confirm `GET /admin/backups` shows a fresh `SUCCEEDED` run before considering the incident closed.

## What a restore actually recovers (Track B scope)

The restore mechanism operates on every real table in `public` (minus `_prisma_migrations`), so a full restore recovers ALL of the following as one atomic set — there is no separate, partial recovery path for any one category: users and auth (sessions, password reset tokens), workspaces and membership, billing (subscriptions, invoices, payments), AI usage and the credit ledger (`AICredit`, `AIUsage`), workflows and their scheduling state, notifications, and the full audit log (`AuditLog`). This is verified structurally (the table enumeration has no allowlist/denylist logic that would silently exclude a category) and empirically (`phase31`/`phase32` integration tests restore into an isolated schema and assert real row counts across many of these tables, and the manifest's `mismatches` check would fail loudly if any table were silently skipped).

## Known, honest limitations (do not assume these are solved)

- **Off-site (S3-compatible) upload code is real, but has never been exercised against a genuine cloud account in this environment.** No `S3_*` credentials exist in `.env` as of this writing — `BLOCKED — CREDENTIAL`. Until a real bucket/credential is provisioned and one real end-to-end cycle (upload → download → decrypt → restore) is run against it, treat backups as effectively local-disk-only for planning purposes: a disk/host failure that takes the database down may also take the backups with it if they share the same host.
- **The full-new-database-provisioning path has not been rehearsed against a truly separate physical server** in this environment (only against the same real Postgres instance, via an isolated schema). Treat the exact timing as directional, not guaranteed, until it has been.
- **No automated corruption detection runs continuously against live `public` data** — only backup ARTIFACTS are self-verified (checksums at write time, and a full restore-into-isolated-schema check after every backup). A live data-integrity monitor watching `public` directly is a real, separate piece of future work.
- **No DR drill has been run with the primary database instance genuinely offline.** All rehearsals so far restore into an isolated schema of the SAME reachable Postgres instance. This proves the restore mechanics are correct; it does not prove operational readiness for a real full-instance loss (provisioning time, DNS/connection-string cutover, etc. are all unmeasured).
