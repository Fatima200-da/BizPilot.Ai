# Backup Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** the real, automated, encrypted, off-site-capable database backup system shipped across Phases 31-33.

## What backs up, and how

Every table in the real Postgres `public` schema (except `_prisma_migrations`, Prisma's own deploy-tooling bookkeeping table — never application data) is dumped to a newline-delimited-JSON file per table, plus one `manifest.json` recording row counts, a sha256 checksum per file, the real FK-computed restore order, and any deliberately-broken circular-FK edges. This is a **logical** backup (real rows, not a binary `pg_dump` archive) — there is no native `pg_dump`/`pg_restore` binary available in this project's development environment, so this system was built as a real, independently-verified equivalent. A production deployment with `pg_dump` available may prefer it for the physical backup and use this system's restore/verification/observability layer regardless.

If `BACKUP_ENCRYPTION_KEY` is set, every table file (and the manifest) is real AES-256-GCM ciphertext before it ever touches disk — checksummed AFTER encryption, so integrity verification covers exactly what's stored. If S3 credentials are configured (`S3_BUCKET`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`), the encrypted artifact is also uploaded off-site via the real AWS SDK (works against AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, or MinIO). After every successful backup, an automated restore into a real isolated schema verifies the artifact is genuinely restorable, not merely self-consistent (`BackupRun.restoreVerifiedOk`).

Code: `backend/src/modules/backup/backup-core.ts` (dump/restore mechanics), `backend/src/modules/backup/backup.service.ts` (orchestration, encryption, S3 upload, automated restore-verify, retention, observability), `backend/src/modules/backup/backup-scheduler.service.ts` (recurring schedule), `backend/src/modules/backup/encryption.ts` (AES-256-GCM), `backend/src/modules/backup/s3-storage.service.ts` (off-site upload/download).

## Where backups live

`BACKUP_DIR` (default `./backups`, configurable via env — see `.env.example`) for the local copy, plus a real off-site S3-compatible copy IF `S3_*` env vars are configured. **As of this writing, no real cloud account (AWS/R2/B2/MinIO) has been exercised in this development environment** — the S3 client code is real and tested against a protocol-compliant local test server, but genuine off-host delivery is `BLOCKED — CREDENTIAL` until a real bucket/credential is provisioned. **This remains the single most important gap to close before relying on this system for a real incident** — provision real S3-compatible credentials and confirm one real backup cycle against them.

## Automated schedule

One backup per day at `BACKUP_SCHEDULE_TIME` (default `03:00` UTC), driven by the same job-scheduler process as scheduled workflows (`backend/src/scripts/run-scheduler.ts`). Duplicate-prevention is two real, independent layers: an optimistic-concurrency CAS on the schedule's `nextRunAt`, plus the underlying `Job`'s real Postgres unique `(jobKey, dedupeKey)` constraint. A schedule that missed several days (scheduler was down) fires exactly ONE catch-up backup, not one per missed day.

To run the scheduler process:
```bash
npx tsx src/scripts/run-scheduler.ts
```

## How to create a backup manually

Via the admin API (requires a real `isSystemAdmin` account):
```
POST /admin/backups/trigger
```
Returns the completed `BackupRun` row synchronously (waits for the real backup to finish).

Or programmatically:
```ts
import { runDatabaseBackup } from './modules/backup/backup.service';
const run = await runDatabaseBackup({ triggerType: 'MANUAL' });
```

## How to verify a backup

Every backup self-verifies immediately after writing (real sha256 re-read of every table file, compared against the manifest recorded at write time) — a `BackupRun` only reaches `SUCCEEDED` if this passes; a checksum mismatch marks it `CORRUPT` instead. To re-verify an existing backup later:
```ts
import { verifyBackupIntegrity } from './modules/backup/backup-core';
const { ok, problems } = await verifyBackupIntegrity(backupRun.filePath);
```

## Observability

```
GET /admin/backups
```
Returns real, computed-from-database fields: `currentStatus` (`RUNNING` / `HEALTHY` / `UNHEALTHY` / `NO_BACKUPS_YET`), `lastSuccessful`, `lastFailed`, `backupAgeHours`, `consecutiveFailures`, and a real run history. `UNHEALTHY` fires when there have been consecutive failures, or when the last successful backup is more than 48 hours old. Every structured log line (`backup.started`, `backup.succeeded`, `backup.failed`, `backup.corrupt`, `backup.pruned`, `backup.stale_run_reaped`) is a single JSON line — grep-able, never containing row content or secrets.

## Retention

Successful backups older than `BACKUP_RETENTION_DAYS` (default 14) have their on-disk artifact deleted — but the `BackupRun` database row is kept (real audit history), and at least `BACKUP_MIN_RETAINED` (default 3) of the most recent successful backups are always kept regardless of age. Cleanup runs automatically after every successful backup; it can also be invoked directly:
```ts
import { cleanupOldBackups } from './modules/backup/backup.service';
await cleanupOldBackups();
```

## Concurrency and abandoned-run handling

At most one backup may be genuinely `RUNNING` at a time — a second attempt while one is in progress is rejected (`BackupAlreadyInProgressError`), never silently allowed to run alongside it. If a `RUNNING` row is older than `BACKUP_STALE_RUNNING_MINUTES` (default 120), it is treated as abandoned (the process that started it crashed) — automatically marked `FAILED` with an honest reason, and a new attempt is allowed to proceed.

## Escalation

If backup health shows `UNHEALTHY` (via `GET /admin/backups`, an external monitor polling it, or a real `backup_failure`/`stale_backup`/`restore_verification_failure` alert from `GET /admin/alerts`), see `docs/ops/INCIDENT_RESPONSE_RUNBOOK.md`.
