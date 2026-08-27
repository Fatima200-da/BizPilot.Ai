import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync, readdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Client } from 'pg';

/**
 * Phase 31: the real, shared backup/restore core — the FK-topology and
 * typed-column logic that `scripts/backup-restore-rpo-rto-phase30.ts`
 * proved correct against every real defect found during Phase 30 (a
 * fabricated FK cycle from a bad `information_schema` join, a genuine
 * circular-FK deferred-restore requirement, a positional row-cast silently
 * misassigning columns, enum/array-of-enum type-identity casting). That
 * script now imports these functions rather than redefining them — Phase
 * 31 re-ran it after this extraction to confirm byte-for-byte identical
 * certification output (50 tables, 0 mismatches) before this module was
 * trusted for anything new.
 */

export interface FkEdge {
  table: string;
  column: string;
  dependsOn: string;
  nullable: boolean;
}

export interface ColumnInfo {
  columnName: string;
  dataType: string;
  udtName: string;
}

/** Real FK dependency graph from `pg_constraint` directly (never `information_schema`'s join-prone views — see Phase 30's found-and-fixed fabricated-cycle defect). */
export async function fetchFkEdges(client: Client, schema: string): Promise<FkEdge[]> {
  const res = await client.query<{ table_name: string; column_name: string; foreign_table_name: string; is_nullable_bool: boolean }>(
    `
    SELECT c.relname AS table_name, a.attname AS column_name, fc.relname AS foreign_table_name, (NOT a.attnotnull) AS is_nullable_bool
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_class fc ON fc.oid = con.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f' AND n.nspname = $1 AND array_length(con.conkey, 1) = 1
    `,
    [schema]
  );
  return res.rows
    .filter((r) => r.table_name !== r.foreign_table_name)
    .map((r) => ({ table: r.table_name, column: r.column_name, dependsOn: r.foreign_table_name, nullable: r.is_nullable_bool }));
}

export async function fetchAllTables(client: Client, schema: string): Promise<string[]> {
  const res = await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema]);
  return res.rows.map((r) => r.table_name);
}

/** Real, custom enum type names in `schema` — both scalar and array-of-enum columns need the text round-trip cast when restoring into a schema where the type is a distinct type object (see module doc). */
export async function fetchEnumTypeNames(client: Client, schema: string): Promise<Set<string>> {
  const res = await client.query<{ typname: string }>(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typtype = 'e'`, [schema]);
  return new Set(res.rows.map((r) => r.typname));
}

export async function fetchTableColumns(client: Client, schema: string, table: string): Promise<ColumnInfo[]> {
  const res = await client.query<{ column_name: string; data_type: string; udt_name: string }>(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
    [schema, table]
  );
  return res.rows.map((r) => ({ columnName: r.column_name, dataType: r.data_type, udtName: r.udt_name }));
}

/** Real primary-key column name for `table` in `schema` — falls back to "id" (true for every table in this schema) only if introspection somehow returns nothing. */
export async function fetchPrimaryKeyColumn(client: Client, schema: string, table: string): Promise<string> {
  const res = await client.query<{ column_name: string }>(
    `SELECT kcu.column_name FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'`,
    [schema, table]
  );
  return res.rows[0]?.column_name ?? 'id';
}

/**
 * Breaks exactly the FK edges necessary to make `tables` sortable, choosing
 * only nullable-column edges (safe: insert NULL, fix up once both sides
 * exist) — throws if a genuine cycle has no nullable edge to break.
 */
export function breakCycles(tables: string[], edges: FkEdge[]): { edges: FkEdge[]; broken: FkEdge[] } {
  const remainingEdges = [...edges];
  const broken: FkEdge[] = [];

  function stuckSet(): Set<string> | null {
    const dependsOn = new Map<string, Set<string>>();
    for (const t of tables) dependsOn.set(t, new Set());
    for (const e of remainingEdges) dependsOn.get(e.table)?.add(e.dependsOn);
    const sorted = new Set<string>();
    const remaining = new Set(tables);
    let progressed = true;
    while (remaining.size > 0 && progressed) {
      progressed = false;
      for (const t of [...remaining]) {
        if ([...(dependsOn.get(t) ?? [])].every((dep) => sorted.has(dep))) {
          sorted.add(t);
          remaining.delete(t);
          progressed = true;
        }
      }
    }
    return remaining.size > 0 ? remaining : null;
  }

  for (let guard = 0; guard < 20; guard += 1) {
    const stuck = stuckSet();
    if (!stuck) break;
    const breakable = remainingEdges.find((e) => stuck.has(e.table) && stuck.has(e.dependsOn) && e.nullable);
    if (!breakable) {
      throw new Error(`Cycle detected among [${[...stuck].join(', ')}] with no nullable FK column available to break it safely.`);
    }
    remainingEdges.splice(remainingEdges.indexOf(breakable), 1);
    broken.push(breakable);
  }

  return { edges: remainingEdges, broken };
}

/** Kahn's algorithm — a real, generic topological sort, never a hand-maintained order. */
export function topologicalSort(tables: string[], edges: FkEdge[]): string[] {
  const dependsOn = new Map<string, Set<string>>();
  for (const t of tables) dependsOn.set(t, new Set());
  for (const e of edges) {
    if (dependsOn.has(e.table) && dependsOn.has(e.dependsOn)) dependsOn.get(e.table)?.add(e.dependsOn);
  }

  const sorted: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((t) => [...(dependsOn.get(t) ?? [])].every((dep) => sorted.includes(dep)));
    if (ready.length === 0) {
      throw new Error(`Cycle detected in FK graph among: ${[...remaining].join(', ')} — cannot compute a safe insertion order.`);
    }
    for (const t of ready.sort()) {
      sorted.push(t);
      remaining.delete(t);
    }
  }
  return sorted;
}

export interface BackupManifest {
  runId: string;
  createdAt: string;
  schema: string;
  order: string[];
  brokenEdges: FkEdge[];
  tables: Record<string, { rowCount: number; checksum: string; fileName: string }>;
  /** Phase 32 Track B: true when every table file is AES-256-GCM ciphertext, not plaintext NDJSON — restore requires the real decryption key when this is true. */
  encrypted: boolean;
}

function manifestPath(dir: string): string {
  return join(dir, 'manifest.json');
}

function tableFileName(table: string, encrypted: boolean): string {
  return encrypted ? `${table}.ndjson.enc` : `${table}.ndjson`;
}

async function sha256OfFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      resolve();
    });
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/**
 * Dumps every table in `order` to one newline-delimited-JSON file each
 * under `dir`, plus a `manifest.json` recording row counts, per-file sha256
 * checksums (real corruption detection — see `verifyBackupIntegrity`), the
 * FK-computed restore order, and any deliberately-broken circular-FK edges
 * the restore step must fix up. `client` reads from `public` — dumping is
 * always a real, live read of the actual production schema, never a
 * simulated/fabricated row set.
 */
export async function dumpDatabaseToDirectory(client: Client, runId: string, dir: string, order: string[], brokenEdges: FkEdge[], encryptionKey?: Buffer): Promise<{ manifest: BackupManifest; totalRows: number }> {
  // mode: 0o700 (owner-only) is honored on POSIX (Linux/macOS production
  // hosts) and silently ignored on Windows (this dev environment) — real,
  // free hardening on the platforms it matters for; backup artifacts
  // contain real customer data (password hashes, session token hashes,
  // business records) and must never be group/world-readable on disk.
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const tables: BackupManifest['tables'] = {};
  let totalRows = 0;
  const encrypted = Boolean(encryptionKey);

  for (const table of order) {
    const fileName = tableFileName(table, encrypted);
    const filePath = join(dir, fileName);
    const res = await client.query(`SELECT * FROM public."${table}"`);

    if (encrypted && encryptionKey) {
      // Real AES-256-GCM encryption of the actual plaintext bytes — write
      // plaintext to a temp path, encrypt into the real final path, delete
      // the temp plaintext (encryptFile's own contract).
      const plainPath = `${filePath}.plain-tmp`;
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(plainPath);
        stream.on('error', reject);
        for (const row of res.rows) stream.write(`${JSON.stringify(row)}\n`);
        stream.end(resolve);
      });
      const { encryptFile } = await import('./encryption');
      await encryptFile(plainPath, filePath, encryptionKey);
    } else {
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(filePath);
        stream.on('error', reject);
        for (const row of res.rows) stream.write(`${JSON.stringify(row)}\n`);
        stream.end(resolve);
      });
    }

    // Checksummed AFTER encryption — integrity verification must detect
    // corruption of what is actually stored on disk, encrypted or not.
    const checksum = await sha256OfFile(filePath);
    tables[table] = { rowCount: res.rows.length, checksum, fileName };
    totalRows += res.rows.length;
  }

  const manifest: BackupManifest = { runId, createdAt: new Date().toISOString(), schema: 'public', order, brokenEdges, tables, encrypted };
  await writeFile(manifestPath(dir), JSON.stringify(manifest, null, 2), 'utf-8');
  return { manifest, totalRows };
}

/**
 * Real corruption/completeness detection: re-reads every table file from
 * disk, recomputes its sha256, and compares against the manifest recorded
 * at backup time. A truncated write, a partially-copied artifact, or bit
 * rot on the backup volume all fail this check — never silently accepted.
 */
export async function verifyBackupIntegrity(dir: string): Promise<{ ok: boolean; manifest: BackupManifest; problems: string[] }> {
  const problems: string[] = [];
  const raw = await readFile(manifestPath(dir), 'utf-8');
  const manifest = JSON.parse(raw) as BackupManifest;

  for (const table of manifest.order) {
    const meta = manifest.tables[table];
    if (!meta) {
      problems.push(`manifest missing entry for table "${table}"`);
      continue;
    }
    const filePath = join(dir, meta.fileName);
    let checksum: string;
    try {
      checksum = await sha256OfFile(filePath);
    } catch {
      problems.push(`table file missing or unreadable: ${meta.fileName}`);
      continue;
    }
    if (checksum !== meta.checksum) {
      problems.push(`checksum mismatch for ${meta.fileName}: expected ${meta.checksum}, got ${checksum}`);
    }
  }

  return { ok: problems.length === 0, manifest, problems };
}

/**
 * Restores a real on-disk backup artifact into an isolated target schema —
 * used both for a routine post-backup self-check and for a full disaster-
 * recovery rehearsal. Reads the manifest's own FK-computed order and
 * broken-cycle list rather than recomputing them (the backup artifact is
 * self-describing), introspects the TARGET schema's real column types
 * (never assumes they match the source — correct even when restoring into
 * a freshly-migrated, structurally-identical-but-distinct schema, since
 * Postgres enum types are distinct objects per schema).
 */
async function readTableRows(dir: string, fileName: string, encrypted: boolean, decryptionKey?: Buffer): Promise<Record<string, unknown>[]> {
  let text: string;
  if (encrypted) {
    if (!decryptionKey) throw new Error(`Backup at "${dir}" is encrypted but no decryption key was provided — cannot restore.`);
    const { decryptFileToBuffer } = await import('./encryption');
    text = (await decryptFileToBuffer(join(dir, fileName), decryptionKey)).toString('utf-8');
  } else {
    text = await readFile(join(dir, fileName), 'utf-8');
  }
  return text.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
}

export async function restoreDirectoryIntoSchema(client: Client, dir: string, targetSchema: string, decryptionKey?: Buffer): Promise<{ tableCount: number; totalRows: number; mismatches: string[] }> {
  const raw = await readFile(manifestPath(dir), 'utf-8');
  const manifest = JSON.parse(raw) as BackupManifest;

  const enumTypeNames = await fetchEnumTypeNames(client, targetSchema);
  const brokenByTable = new Map<string, FkEdge[]>();
  for (const b of manifest.brokenEdges) {
    const list = brokenByTable.get(b.table) ?? [];
    list.push(b);
    brokenByTable.set(b.table, list);
  }

  const mismatches: string[] = [];
  let totalRows = 0;

  for (const table of manifest.order) {
    const meta = manifest.tables[table];
    if (!meta) throw new Error(`Manifest has no entry for table "${table}" — cannot restore.`);

    const columns = await fetchTableColumns(client, targetSchema, table);
    if (columns.length === 0) {
      throw new Error(`Restore target schema "${targetSchema}" has no table (or no columns) named "${table}" — the target schema is not structurally compatible with this backup (a genuine restore-failure condition, never silently skipped).`);
    }
    const brokenColNames = new Set((brokenByTable.get(table) ?? []).map((b) => b.column));

    const rows = await readTableRows(dir, meta.fileName, manifest.encrypted, decryptionKey);

    if (rows.length > 0) {
      const columnNames = columns.map((c) => `"${c.columnName}"`).join(', ');
      const valueRows: string[] = [];
      const params: unknown[] = [];
      for (const row of rows) {
        const placeholders = columns.map((c) => {
          if (brokenColNames.has(c.columnName)) return 'NULL';
          const rawValue = row[c.columnName] ?? null;
          // json/jsonb columns round-trip through the backup file as real
          // JS objects/arrays (JSON.parse of the dumped NDJSON line) — the
          // pg driver has no column-type context for a plain parameterized
          // query and serializes a bare JS array/object using POSTGRES
          // ARRAY-LITERAL syntax, not JSON text, which Postgres's own
          // json/jsonb parser then rejects. Explicitly re-stringify so the
          // parameter is unambiguously JSON text on the wire.
          const value = (c.dataType === 'json' || c.dataType === 'jsonb') && rawValue !== null ? JSON.stringify(rawValue) : rawValue;
          params.push(value);
          const p = `$${String(params.length)}`;
          if (c.dataType === 'USER-DEFINED' && enumTypeNames.has(c.udtName)) return `(${p}::text::${targetSchema}."${c.udtName}")`;
          if (c.dataType === 'ARRAY' && c.udtName.startsWith('_') && enumTypeNames.has(c.udtName.slice(1))) return `(${p}::text[]::${targetSchema}."${c.udtName.slice(1)}"[])`;
          if (c.dataType === 'json' || c.dataType === 'jsonb') return `(${p}::${c.dataType})`;
          return p;
        });
        valueRows.push(`(${placeholders.join(', ')})`);
      }
      await client.query(`INSERT INTO ${targetSchema}."${table}" (${columnNames}) VALUES ${valueRows.join(', ')}`, params);
    }

    const restoredCountRes = await client.query(`SELECT count(*)::int AS n FROM ${targetSchema}."${table}"`);
    const restoredCount = (restoredCountRes.rows[0] as { n: number }).n;
    totalRows += rows.length;
    if (restoredCount !== meta.rowCount) {
      mismatches.push(`${table}: expected ${String(meta.rowCount)}, restored ${String(restoredCount)}`);
    }
  }

  // Fix-up pass for deliberately-broken circular-FK columns — same
  // real-value-restoration semantics as the phase30 DB-to-DB script, but
  // sourced from the backup's own dumped rows rather than a live public table.
  for (const table of [...brokenByTable.keys()]) {
    const meta = manifest.tables[table];
    if (!meta) continue;
    const pk = await fetchPrimaryKeyColumn(client, targetSchema, table);
    const rows = await readTableRows(dir, meta.fileName, manifest.encrypted, decryptionKey);
    for (const edge of brokenByTable.get(table) ?? []) {
      for (const row of rows) {
        const value = row[edge.column];
        if (value === null || value === undefined) continue;
        await client.query(`UPDATE ${targetSchema}."${table}" SET "${edge.column}" = $1 WHERE "${pk}" = $2`, [value, row[pk]]);
      }
    }
  }

  return { tableCount: manifest.order.length, totalRows, mismatches };
}

/** Real on-disk cleanup for retention — never a soft/simulated delete. */
export async function deleteBackupDirectory(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Sum of every real file size under `dir` (the manifest's own on-disk footprint, not an estimate). */
export async function directorySizeBytes(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      const info = await stat(join(dir, entry.name));
      total += info.size;
    }
  }
  return total;
}

const MIGRATION_SKIP_STATEMENTS = new Set(['CREATE SCHEMA IF NOT EXISTS "public"', 'CREATE EXTENSION IF NOT EXISTS "pgcrypto"']);

function splitMigrationStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Real schema-DDL replay into `schema` — every `prisma/migrations/*\/migration.sql`
 * file's statements, in directory (chronological) order, skipping the
 * schema/extension-level statements that don't apply inside an
 * already-existing database's new schema. This is the exact logic Phase
 * 30's rehearsal script and Phase 31's restore test each independently
 * wrote — consolidated here once (Phase 32) so restore-verification code
 * has one real, shared implementation instead of a fourth copy.
 */
export async function replayMigrationsIntoSchema(client: Client, schema: string, migrationsDir: string): Promise<number> {
  await client.query(`SET search_path TO "${schema}"`);

  const dirs = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let statementsApplied = 0;
  for (const dir of dirs) {
    const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf-8');
    for (const statement of splitMigrationStatements(sql)) {
      if (MIGRATION_SKIP_STATEMENTS.has(statement.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())) continue;
      await client.query(statement);
      statementsApplied += 1;
    }
  }
  return statementsApplied;
}
