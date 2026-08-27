# Restore Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** restoring a real backup artifact created by the Phase 31 backup system. Read `docs/ops/BACKUP_RUNBOOK.md` first if you haven't already.

## Before you start

A restore into a **new, isolated schema or database** is always safe and never touches production/public data — that is how this procedure is written below, and how it was certified (see `docs/PHASE_31_DISASTER_RECOVERY_PRODUCTION_OPERATIONS_CERTIFICATION.md`). A restore that OVERWRITES the live `public` schema is a separate, much higher-risk operation not covered by this document — if you believe you need that, stop and follow `docs/ops/INCIDENT_RESPONSE_RUNBOOK.md`'s escalation path first.

## What you need

1. A `BackupRun` id or its `filePath` (real backup directory containing `manifest.json` + one `.ndjson` file per table). Find one via `GET /admin/backups` or a direct query: `SELECT * FROM backup_runs WHERE status = 'SUCCEEDED' ORDER BY "startedAt" DESC;`
2. A Postgres connection you're allowed to create a new schema in (the SAME database as the backup's source is fine — the restore target is a different, isolated schema, never `public`).

## Procedure

1. **Create an isolated target schema:**
   ```sql
   CREATE SCHEMA restore_verify;
   ```

2. **Replay every migration into that schema** (gives the target the real, structurally-correct tables/types/constraints — this is NOT optional, the restore step assumes the target schema already has the right tables):
   ```ts
   // set search_path to the new schema, then execute every
   // prisma/migrations/*/migration.sql file's statements in directory order
   // (skip "CREATE SCHEMA IF NOT EXISTS public" and
   // "CREATE EXTENSION IF NOT EXISTS pgcrypto" — schema/extension-level,
   // not needed inside a new schema in the same database)
   ```
   See `backend/src/scripts/backup-restore-rpo-rto-phase30.ts`'s `main()` for the exact, already-certified migration-replay logic, or `phase31-backup.integration.test.ts`'s restore test for a minimal working example.

3. **Restore the backup into the schema:**
   ```ts
   import { Client } from 'pg';
   import { restoreDirectoryIntoSchema } from './modules/backup/backup-core';

   const client = new Client({ connectionString: process.env.DATABASE_URL });
   await client.connect();
   const result = await restoreDirectoryIntoSchema(client, backupRun.filePath, 'restore_verify');
   // result: { tableCount, totalRows, mismatches: string[] }
   ```
   `mismatches` MUST be empty. If it is not, this is a real restore failure — do not treat the schema as trustworthy; see the Incident Response runbook.

4. **Verify what you actually care about** (real spot-checks, not just row counts):
   ```sql
   SELECT count(*) FROM restore_verify.workspaces;
   SELECT count(*) FROM restore_verify.users;
   SELECT * FROM restore_verify.subscriptions WHERE status = 'ACTIVE' LIMIT 5;
   ```

5. **Clean up** (once you're done inspecting):
   ```sql
   DROP SCHEMA restore_verify CASCADE;
   ```

## Measuring RTO for this restore

Wrap step 2 and step 3 in `performance.now()` timers — this is exactly how the real, certified RTO measurements in `docs/PHASE_31_DISASTER_RECOVERY_PRODUCTION_OPERATIONS_CERTIFICATION.md` were produced. Real numbers only — never estimate or round up an RTO claim without having actually run the restore.

## Restoring into a genuinely NEW database (full disaster scenario)

If the entire Postgres instance is lost (not just corrupted data), point `DATABASE_URL` at a freshly provisioned Postgres instance, run `npx prisma migrate deploy` against it directly (creates the real `public` schema with every table), then run the same restore procedure above with target schema `public` instead of an isolated one. This path has NOT been rehearsed against a truly separate physical server in this environment — see the certification doc's "remaining risks" section.

## Common failures and what they mean

| Symptom | Real cause | What to do |
|---|---|---|
| `restoreDirectoryIntoSchema` throws "no table (or no columns) named X" | Target schema wasn't migrated first, or was migrated with an OLDER/mismatched migration set | Re-run step 2 with the exact migration set current at the time the backup was taken |
| `mismatches` array is non-empty | A real row-count discrepancy — could be concurrent writes to `public` during a from-live-DB restore rehearsal, or genuine data loss | Re-run once more; if it persists, treat the source backup as suspect and fall back to an older `SUCCEEDED` run |
| `verifyBackupIntegrity` reports `ok: false` before you even attempt a restore | The backup artifact is corrupted on disk (checksum mismatch) | Do not attempt to restore from it — use the next most recent `SUCCEEDED` backup instead |
