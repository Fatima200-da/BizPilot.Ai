# Database Incident Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** the primary PostgreSQL database is unreachable, degraded, or behaving unexpectedly — distinct from `DISASTER_RECOVERY_RUNBOOK.md`, which covers actual data loss/corruption once you're past initial triage. Read this first if you're not yet sure which situation you're in.

## Detecting it

- `GET /health/ready` reports `database: unreachable` (or a non-`reachable` value) — this is the real, direct signal; `/health/live` alone will still say the process is up, since it does not check the database.
- `GET /admin/alerts`'s `database_unavailable` check.
- A sudden spike in 5xx responses across otherwise-unrelated endpoints (`high_api_error_rate` alert) — almost every request path touches the database, so a DB problem shows up as a broad, not localized, error spike.

## Immediate triage

1. **Is it total unreachability or degraded performance?** `GET /health/ready`'s latency and status tell you which. Total unreachability (connection refused/timeout) and severe slowness have different real causes and different next steps.
2. **Check the database's own health independent of the app** — for a managed Postgres provider, its own status page/dashboard; for a self-hosted instance, `pg_isready`, disk space (`df -h` on the DB host — a full disk is one of the most common real causes of a Postgres outage), and `SELECT count(*) FROM pg_stat_activity;` for a connection-exhaustion situation.
3. **Check the app's own connection pool** — Prisma's pool has a real, finite size; a spike in concurrent requests exhausting it looks like "the database is down" from the app's perspective even when Postgres itself is healthy. Compare `pg_stat_activity`'s real connection count against the configured pool size.

## Common real causes and what to do

| Symptom | Likely real cause | Action |
|---|---|---|
| Connection refused / total unreachability | DB process down, network partition, or a managed provider outage | Check the provider's status page first (nothing to do on your end during a genuine provider outage besides communicating it); for self-hosted, check the Postgres process/container is actually running |
| `ENOSPC` / disk-full errors in Postgres logs | Disk full — very often from unbounded WAL growth, log growth, or the backup system writing to the SAME disk as the database (see `BACKUP_RUNBOOK.md`'s off-site-storage gap — this is exactly the scenario that gap makes worse) | Free space (rotate/delete old logs, confirm backups aren't accumulating locally without the retention cleanup running — `GET /admin/backups`), then confirm the DB recovers on its own once space is available |
| Connection pool exhaustion (app-side) | A real traffic spike, a slow query holding connections longer than normal, or a connection leak (a code path acquiring a client and not releasing it) | Check `pg_stat_activity` for connections stuck in a long-running or idle-in-transaction state — those point at a real leak or a genuinely slow query, not just volume |
| Sudden severe slowness, no errors yet | A missing index newly exposed by a data-volume change, a lock held by a long transaction, or a real resource-contention issue (CPU/IO on the DB host) | Real `EXPLAIN ANALYZE` on the slowest-looking queries (see Phase 34's Track J methodology — measure, don't guess); `SELECT * FROM pg_locks WHERE NOT granted;` for lock contention |
| Data present but wrong | Not a "database unreachable" incident — this is `DISASTER_RECOVERY_RUNBOOK.md`'s "data corruption" scenario | Switch runbooks — do not attempt a repair here |

## Recovery verification

Once you believe the underlying cause is resolved: `GET /health/ready` must report `database: reachable` genuinely (not cached — hit it fresh), and a real read + write smoke test (e.g., a real login) should succeed before you consider the incident closed. If backups or the scheduler were paused/affected during the outage, follow `SCHEDULER_WORKER_RECOVERY.md` and `BACKUP_RUNBOOK.md`'s own recovery-verification steps too — a database incident often has downstream effects on both.

## Escalation

A prolonged (multi-minute-plus) total outage, or any real data-loss risk discovered during triage, is SEV1 per `INCIDENT_RESPONSE_RUNBOOK.md` — follow its escalation and postmortem requirements.
