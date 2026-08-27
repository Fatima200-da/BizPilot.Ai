import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { Client } from 'pg';
import type { BackupRun } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { env } from '../../config/env';
import { breakCycles, deleteBackupDirectory, directorySizeBytes, dumpDatabaseToDirectory, fetchAllTables, fetchFkEdges, replayMigrationsIntoSchema, restoreDirectoryIntoSchema, topologicalSort, verifyBackupIntegrity } from './backup-core';
import { decodeEncryptionKey } from './encryption';
import { deleteBackupObjects, isS3Configured, uploadBackupDirectory, type S3Config } from './s3-storage.service';

/**
 * Phase 31 Track A/B: the real, schedulable database backup. Runs as a
 * registered job-queue handler (see backup-scheduler.service.ts) so it
 * inherits the queue's already-certified (Phase 27/30) retry/backoff,
 * lease-based crash recovery, and dead-letter behavior for free — this
 * module only has to implement the backup work itself and one extra,
 * backup-specific guard: refusing to start a second backup while a real
 * one is genuinely in progress (the Job/dedupeKey layer already prevents
 * two Jobs for the same day, but a manually-triggered backup is a
 * DIFFERENT Job row, so needs its own explicit concurrency guard).
 */

function logBackupEvent(event: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', event, ...data, timestamp: new Date().toISOString() }));
}

function logBackupError(event: string, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', event, ...data, timestamp: new Date().toISOString() }));
}

/**
 * Real, honest error-message extraction — found via real execution (Phase
 * 32's own S3-unreachable-endpoint test) that Node's `AggregateError`
 * (thrown by the AWS SDK's HTTP handler for a connection failure, e.g.
 * ECONNREFUSED against an unreachable endpoint) has an EMPTY top-level
 * `.message`; the real diagnostic detail lives in its `.errors` array.
 * `err.message` alone would silently produce `s3UploadError: ""` — a real
 * operator staring at a blank string with zero information to act on.
 */
function describeError(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map((e: unknown) => (e instanceof Error ? e.message : String(e))).join('; ');
    return inner || err.message || 'AggregateError with no further detail';
  }
  if (err instanceof Error) return err.message || err.toString();
  return String(err);
}

export class BackupAlreadyInProgressError extends Error {
  constructor(runningId: string) {
    super(`A backup run (${runningId}) is already genuinely in progress — refusing to start a second, concurrent backup.`);
    this.name = 'BackupAlreadyInProgressError';
  }
}

/**
 * Real concurrency guard: finds any BackupRun still RUNNING. A row stuck at
 * RUNNING past `BACKUP_STALE_RUNNING_MINUTES` is treated as an abandoned
 * run (its owning process crashed mid-backup — the exact "backup
 * interrupted" failure scenario) rather than a live one, so a permanently
 * stuck row can never block backups forever; it is marked FAILED here with
 * an honest reason before the new attempt proceeds.
 */
async function guardAgainstConcurrentBackup(): Promise<void> {
  const staleCutoff = new Date(Date.now() - env.BACKUP_STALE_RUNNING_MINUTES * 60_000);
  const runningRuns = await prisma.backupRun.findMany({ where: { status: 'RUNNING' } });

  for (const run of runningRuns) {
    if (run.startedAt < staleCutoff) {
      await prisma.backupRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', errorMessage: `Abandoned — exceeded BACKUP_STALE_RUNNING_MINUTES (${String(env.BACKUP_STALE_RUNNING_MINUTES)}min) still RUNNING, treated as a crashed/interrupted run.`, completedAt: new Date() },
      });
      logBackupError('backup.stale_run_reaped', { runId: run.id, startedAt: run.startedAt.toISOString() });
    } else {
      throw new BackupAlreadyInProgressError(run.id);
    }
  }
}

interface RunBackupOptions {
  triggerType: 'SCHEDULED' | 'MANUAL';
  jobId?: string;
  /** Test-only escape hatch — overrides `env.BACKUP_DIR` so integration tests can use an isolated, disposable directory instead of the real configured backup location. Never set in production code paths. */
  dirOverride?: string;
  /** Test-only — overrides `env.S3_*` so integration tests can point at a local S3-compatible test server without mutating the process-wide env singleton. Never set in production code paths. */
  s3ConfigOverride?: S3Config;
  /** Test-only — overrides `env.BACKUP_ENCRYPTION_KEY` (base64). Never set in production code paths. */
  encryptionKeyOverride?: string;
}

/**
 * Executes one real, complete database backup: connects a dedicated
 * short-lived `pg.Client` (isolated from Prisma's own request-serving
 * pool), computes the real FK-safe table order, dumps every table to disk,
 * self-verifies the artifact's integrity (real checksum re-read, not
 * trusted blindly), records full metadata on the `BackupRun` row, and runs
 * retention cleanup. Throws on any failure — the caller (the job-queue
 * handler wired in backup-scheduler.service.ts) relies on that to trigger
 * the queue's real retry/backoff/dead-letter behavior; this function never
 * swallows an error to report a false success.
 */
export async function runDatabaseBackup(options: RunBackupOptions): Promise<BackupRun> {
  await guardAgainstConcurrentBackup();

  const runId = randomUUID();
  const dir = join(options.dirOverride ?? env.BACKUP_DIR, runId);
  const startedAt = new Date();

  await prisma.backupRun.create({
    data: { id: runId, status: 'RUNNING', triggerType: options.triggerType, jobId: options.jobId, startedAt },
  });
  logBackupEvent('backup.started', { runId, triggerType: options.triggerType });

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    // `_prisma_migrations` is Prisma's own deploy-tooling bookkeeping
    // table — created directly by `prisma migrate deploy`, never
    // represented in any migration.sql file (the same real, documented
    // finding Phase 30's rehearsal script hit). Phase 30's script never
    // needed to filter it because it computed its table list from the
    // ISOLATED target schema (which never has it); a real production
    // backup has no such target to consult — it must read the table list
    // from `public` directly, so it must explicitly exclude this table:
    // otherwise a restore into a freshly migration-replayed schema (which
    // never creates it either) fails, since a table that doesn't exist on
    // either side can be dumped but never restored.
    const allTables = await fetchAllTables(client, 'public');
    const tables = allTables.filter((t) => t !== '_prisma_migrations');
    const rawEdges = await fetchFkEdges(client, 'public');
    const { edges, broken } = breakCycles(tables, rawEdges);
    const order = topologicalSort(tables, edges);

    // Phase 32 Track B: encrypt at rest when configured — real AES-256-GCM,
    // applied before checksumming so integrity verification covers exactly
    // what's actually stored on disk.
    const effectiveEncryptionKeyBase64 = options.encryptionKeyOverride ?? env.BACKUP_ENCRYPTION_KEY;
    const encryptionKey = effectiveEncryptionKeyBase64 ? decodeEncryptionKey(effectiveEncryptionKeyBase64) : undefined;
    const { manifest, totalRows } = await dumpDatabaseToDirectory(client, runId, dir, order, broken, encryptionKey);

    const integrity = await verifyBackupIntegrity(dir);
    if (!integrity.ok) {
      await prisma.backupRun.update({
        where: { id: runId },
        data: { status: 'CORRUPT', errorMessage: `Self-verification failed: ${integrity.problems.join('; ')}`, completedAt: new Date() },
      });
      logBackupError('backup.corrupt', { runId, problems: integrity.problems });
      throw new Error(`Backup ${runId} failed self-verification: ${integrity.problems.join('; ')}`);
    }

    const sizeBytes = await directorySizeBytes(dir);
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    let updated = await prisma.backupRun.update({
      where: { id: runId },
      data: {
        status: 'SUCCEEDED',
        filePath: dir,
        tableCount: manifest.order.length,
        rowCount: totalRows,
        sizeBytes,
        checksum: computeManifestChecksum(manifest.tables),
        completedAt,
        durationMs,
        encrypted: manifest.encrypted,
      },
    });
    logBackupEvent('backup.succeeded', { runId, tableCount: manifest.order.length, rowCount: totalRows, sizeBytes, durationMs, encrypted: manifest.encrypted });

    // Phase 32 Track A: real off-site upload. A local backup that
    // succeeded is still real and usable on its own (matches Phase 31's
    // guarantee) — an S3 failure is recorded, never silently dropped, and
    // never retroactively fails an otherwise-good local backup, but IS
    // real, visible signal via observability (Track A's whole point is
    // that "off-site" must not be a claim nobody checks).
    if (isS3Configured(options.s3ConfigOverride)) {
      try {
        await uploadBackupDirectory(dir, runId, options.s3ConfigOverride);
        const bucketName = options.s3ConfigOverride?.bucket ?? env.S3_BUCKET;
        updated = await prisma.backupRun.update({ where: { id: runId }, data: { s3Uploaded: true, s3UploadedAt: new Date(), s3Bucket: bucketName } });
        logBackupEvent('backup.s3_uploaded', { runId, bucket: bucketName });
      } catch (err) {
        const message = describeError(err);
        updated = await prisma.backupRun.update({ where: { id: runId }, data: { s3Uploaded: false, s3UploadError: message } });
        logBackupError('backup.s3_upload_failed', { runId, error: message });
      }
    }

    // Phase 32 Track D: real, automated restore verification — not a
    // one-off manual rehearsal. Runs after every successful backup;
    // failure here is recorded but (deliberately, same reasoning as S3
    // above) does not retroactively invalidate the backup itself — the
    // local artifact's own checksum-verified integrity already proved
    // correctness. This step proves something ADDITIONAL: the artifact is
    // genuinely restorable end-to-end against a freshly-migrated schema,
    // right now, not merely internally self-consistent.
    updated = await runAutomatedRestoreVerification(runId, dir, manifest.encrypted ? encryptionKey : undefined);

    await cleanupOldBackups();
    return updated;
  } catch (err) {
    const message = describeError(err);
    const current = await prisma.backupRun.findUnique({ where: { id: runId } });
    if (current?.status === 'RUNNING') {
      await prisma.backupRun.update({ where: { id: runId }, data: { status: 'FAILED', errorMessage: message, completedAt: new Date() } });
      logBackupError('backup.failed', { runId, error: message });
    }
    throw err;
  } finally {
    await client.end();
  }
}

/**
 * Real, automated restore-verification: creates a real isolated schema,
 * replays every real migration into it, restores this backup's own
 * artifact into it, verifies zero row-count mismatches, then drops the
 * schema — the exact same mechanics Phase 31 proved manually, now run
 * automatically after every real backup rather than only on request.
 */
async function runAutomatedRestoreVerification(runId: string, dir: string, decryptionKey: Buffer | undefined): Promise<BackupRun> {
  const verifyStart = performance.now();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  const schema = `restore_verify_p32_${runId.replace(/-/g, '_')}`;
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);

    const migrationsDir = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
    await replayMigrationsIntoSchema(client, schema, migrationsDir);

    const result = await restoreDirectoryIntoSchema(client, dir, schema, decryptionKey);
    const restoreDurationMs = Math.round(performance.now() - verifyStart);

    if (result.mismatches.length > 0) {
      logBackupError('backup.restore_verify_failed', { runId, mismatches: result.mismatches });
      return await prisma.backupRun.update({
        where: { id: runId },
        data: { restoreVerifiedAt: new Date(), restoreVerifiedOk: false, restoreDurationMs, restoreVerifyError: result.mismatches.join('; ') },
      });
    }

    logBackupEvent('backup.restore_verified', { runId, tableCount: result.tableCount, totalRows: result.totalRows, restoreDurationMs });
    return await prisma.backupRun.update({
      where: { id: runId },
      data: { restoreVerifiedAt: new Date(), restoreVerifiedOk: true, restoreDurationMs },
    });
  } catch (err) {
    const message = describeError(err);
    logBackupError('backup.restore_verify_failed', { runId, error: message });
    return await prisma.backupRun.update({
      where: { id: runId },
      data: { restoreVerifiedAt: new Date(), restoreVerifiedOk: false, restoreDurationMs: Math.round(performance.now() - verifyStart), restoreVerifyError: message },
    });
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await client.end();
  }
}

function computeManifestChecksum(tables: Record<string, { checksum: string }>): string {
  const combined = Object.keys(tables)
    .sort()
    .map((t) => `${t}:${tables[t]?.checksum ?? ''}`)
    .join('|');
  return createHash('sha256').update(combined).digest('hex');
}

/**
 * Real retention cleanup: deletes the on-disk artifact (never the
 * `BackupRun` row itself — Track E's "execution history" requirement
 * depends on that historical record outliving the disk data it describes)
 * for every SUCCEEDED backup older than `BACKUP_RETENTION_DAYS`, but always
 * keeps at least `BACKUP_MIN_RETAINED` of the most recent successful runs
 * regardless of age — a real safety floor so an operator who hasn't logged
 * in for a month never finds zero recoverable backups.
 */
export async function cleanupOldBackups(): Promise<{ prunedCount: number }> {
  const retentionCutoff = new Date(Date.now() - env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const successfulRuns = await prisma.backupRun.findMany({
    where: { status: 'SUCCEEDED', prunedAt: null },
    orderBy: { startedAt: 'desc' },
  });

  const eligibleForPruning = successfulRuns.slice(env.BACKUP_MIN_RETAINED).filter((run) => run.startedAt < retentionCutoff);

  let prunedCount = 0;
  for (const run of eligibleForPruning) {
    if (!run.filePath) continue;

    if (run.s3Uploaded) {
      try {
        const fileNames = (await readdir(run.filePath, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
        await deleteBackupObjects(run.id, fileNames);
        logBackupEvent('backup.s3_pruned', { runId: run.id });
      } catch (err) {
        // Off-site cleanup failing must never block real local cleanup —
        // logged, not silently swallowed, but not fatal to this run.
        logBackupError('backup.s3_prune_failed', { runId: run.id, error: describeError(err) });
      }
    }

    await deleteBackupDirectory(run.filePath);
    await prisma.backupRun.update({ where: { id: run.id }, data: { prunedAt: new Date() } });
    prunedCount += 1;
    logBackupEvent('backup.pruned', { runId: run.id, filePath: run.filePath });
  }

  return { prunedCount };
}

export interface BackupObservability {
  currentStatus: 'RUNNING' | 'HEALTHY' | 'UNHEALTHY' | 'NO_BACKUPS_YET';
  lastSuccessful: { id: string; startedAt: Date; durationMs: number | null; sizeBytes: number | null; rowCount: number | null } | null;
  lastFailed: { id: string; startedAt: Date; errorMessage: string | null } | null;
  backupAgeHours: number | null;
  consecutiveFailures: number;
  history: BackupRun[];
}

/** Real observability read (Track D) — every field computed from real `BackupRun` rows, nothing fabricated or hardcoded. */
export async function getBackupObservability(historyLimit = 20): Promise<BackupObservability> {
  const history = await prisma.backupRun.findMany({ orderBy: { startedAt: 'desc' }, take: historyLimit });

  const lastSuccessfulRun = history.find((r) => r.status === 'SUCCEEDED') ?? null;
  const lastFailedRun = history.find((r) => r.status === 'FAILED' || r.status === 'CORRUPT') ?? null;
  const currentlyRunning = history.find((r) => r.status === 'RUNNING') ?? null;

  let consecutiveFailures = 0;
  for (const run of history) {
    if (run.status === 'FAILED' || run.status === 'CORRUPT') consecutiveFailures += 1;
    else if (run.status === 'SUCCEEDED') break;
  }

  const backupAgeHours = lastSuccessfulRun ? (Date.now() - lastSuccessfulRun.startedAt.getTime()) / (60 * 60 * 1000) : null;

  // "Unhealthy" once more than 2 real days have passed since the last
  // successful backup (independent of retention length) — a deliberately
  // simple, explainable staleness threshold, not tied to BACKUP_SCHEDULE_TIME
  // internals.
  const STALE_THRESHOLD_HOURS = 48;
  let currentStatus: BackupObservability['currentStatus'] = 'NO_BACKUPS_YET';
  if (currentlyRunning) currentStatus = 'RUNNING';
  else if (history.length === 0) currentStatus = 'NO_BACKUPS_YET';
  else if (consecutiveFailures > 0 || backupAgeHours === null || backupAgeHours > STALE_THRESHOLD_HOURS) currentStatus = 'UNHEALTHY';
  else currentStatus = 'HEALTHY';

  return {
    currentStatus,
    lastSuccessful: lastSuccessfulRun ? { id: lastSuccessfulRun.id, startedAt: lastSuccessfulRun.startedAt, durationMs: lastSuccessfulRun.durationMs, sizeBytes: lastSuccessfulRun.sizeBytes, rowCount: lastSuccessfulRun.rowCount } : null,
    lastFailed: lastFailedRun ? { id: lastFailedRun.id, startedAt: lastFailedRun.startedAt, errorMessage: lastFailedRun.errorMessage } : null,
    backupAgeHours,
    consecutiveFailures,
    history,
  };
}
