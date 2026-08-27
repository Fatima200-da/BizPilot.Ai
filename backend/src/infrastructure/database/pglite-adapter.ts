import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { ColumnTypeEnum, type ColumnType, type SqlQuery, type SqlResultSet } from '@prisma/driver-adapter-utils';

/**
 * Phase 17: a hand-written, minimal Prisma driver adapter for PGlite's
 * NATIVE in-process query interface — deliberately NOT the
 * `@electric-sql/pglite-socket` wire-protocol bridge Phase 16 proved
 * cannot support parameterized queries. PGlite's native `.query(sql,
 * params)` handles parameters correctly (verified directly, no socket
 * layer involved), which is what makes this viable at all.
 *
 * SCOPE AND HONESTY, stated explicitly rather than implied: this adapter
 * is NOT a general-purpose, fully OID-complete Prisma/PGlite bridge (the
 * community packages `pglite-prisma-adapter` / `prisma-pglite` target
 * Prisma 7.x; this repository is pinned to Prisma 6.19.3, and no
 * 6.x-compatible release of either exists). It maps only the Postgres
 * types this schema actually uses (see the OID table below) and is
 * verified against this repository's own real integration test suite —
 * not against an independent correctness reference. Real PostgreSQL
 * (Docker) remains the authoritative verification path;
 * `docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md` states this
 * distinction every time this adapter's results are cited as evidence.
 *
 * NEVER used by default — `infrastructure/database/prisma.ts` only
 * constructs this when `USE_PGLITE_ADAPTER=true` is explicitly set, which
 * production/Docker configuration never sets.
 */

// Postgres OIDs for exactly the types this schema uses (verified via
// `select oid, typname from pg_type` against this schema's own columns).
const OID_TO_COLUMN_TYPE: Record<number, ColumnType> = {
  16: ColumnTypeEnum.Boolean, // bool
  20: ColumnTypeEnum.Int64, // int8 / bigint
  21: ColumnTypeEnum.Int32, // int2
  23: ColumnTypeEnum.Int32, // int4
  25: ColumnTypeEnum.Text, // text
  114: ColumnTypeEnum.Json, // json
  1000: ColumnTypeEnum.BooleanArray, // _bool
  1005: ColumnTypeEnum.Int32Array, // _int4
  1009: ColumnTypeEnum.TextArray, // _text / _varchar
  1043: ColumnTypeEnum.Text, // varchar
  1082: ColumnTypeEnum.Date, // date
  1114: ColumnTypeEnum.DateTime, // timestamp
  1184: ColumnTypeEnum.DateTime, // timestamptz
  1700: ColumnTypeEnum.Numeric, // numeric
  2950: ColumnTypeEnum.Uuid, // uuid
  3802: ColumnTypeEnum.Json, // jsonb
};

function mapColumnType(oid: number): ColumnType {
  return OID_TO_COLUMN_TYPE[oid] ?? ColumnTypeEnum.Text; // safe default: unknown OIDs (mostly dynamically-assigned enum types) come back as their raw string value
}

interface PGliteQueryResult {
  rows: Array<Record<string, unknown>>;
  fields: Array<{ name: string; dataTypeID: number }>;
  affectedRows?: number;
}

/**
 * PGlite's native interface returns already-parsed JS values (Date
 * objects for timestamps, BigInt for int8, objects for jsonb) — correct
 * for JS code reading them directly, but Prisma's query-engine core
 * expects each `SqlResultSet` cell in the specific external representation
 * matching its declared `ColumnType` (ISO strings for dates, decimal
 * strings for 64-bit ints, JSON-encoded strings for Json), not the parsed
 * runtime object. This coercion step is what `@prisma/adapter-pg` gets for
 * free from `pg`'s own type serializers and this adapter must do by hand.
 */
function coerceValue(value: unknown, columnType: ColumnType): unknown {
  if (value === null || value === undefined) return null;
  if (columnType === ColumnTypeEnum.DateTime || columnType === ColumnTypeEnum.Date) {
    return value instanceof Date ? value.toISOString() : value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (columnType === ColumnTypeEnum.Json && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function toSqlResultSet(result: PGliteQueryResult): SqlResultSet {
  const columnNames = result.fields.map((f) => f.name);
  const columnTypes = result.fields.map((f) => mapColumnType(f.dataTypeID));
  const rows = result.rows.map((row) =>
    columnNames.map((name, i) => coerceValue(row[name], columnTypes[i] ?? ColumnTypeEnum.Text))
  );
  return { columnNames, columnTypes, rows, lastInsertId: undefined };
}

export class PGliteQueryable {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'pglite-native-adapter';

  constructor(protected readonly db: PGlite) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const result = (await this.db.query(query.sql, query.args)) as PGliteQueryResult;
    return toSqlResultSet(result);
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    const result = (await this.db.query(query.sql, query.args)) as PGliteQueryResult;
    return result.affectedRows ?? 0;
  }
}

export class PGliteTransaction extends PGliteQueryable {
  readonly options = { usePhantomQuery: false };

  async commit(): Promise<void> {
    await this.db.exec('COMMIT');
  }

  async rollback(): Promise<void> {
    await this.db.exec('ROLLBACK');
  }
}

export class PGliteDriverAdapter extends PGliteQueryable {
  async executeScript(script: string): Promise<void> {
    await this.db.exec(script);
  }

  async startTransaction(): Promise<PGliteTransaction> {
    await this.db.exec('BEGIN');
    return new PGliteTransaction(this.db);
  }

  getConnectionInfo(): { schemaName?: string; supportsRelationJoins: boolean } {
    return { supportsRelationJoins: false };
  }

  async dispose(): Promise<void> {
    // Intentionally a no-op: the underlying PGlite instance is owned and
    // closed by whoever constructed the factory (Section below), not by
    // Prisma Client's own disconnect lifecycle — PGlite's WASM engine is
    // expensive to spin back up and is reused across a whole test run.
  }
}

export class PGliteDriverAdapterFactory {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'pglite-native-adapter';

  /**
   * Takes a Promise, not a live PGlite instance — resolution (including
   * first-call migration) happens lazily inside `connect()`, which is
   * exactly when Prisma Client actually needs it. This is what lets
   * `infrastructure/database/prisma.ts` construct this factory
   * synchronously at module load without a top-level await (unsupported
   * under this project's CommonJS module target).
   */
  constructor(private readonly dbPromise: Promise<PGlite>) {}

  async connect(): Promise<PGliteDriverAdapter> {
    const db = await this.dbPromise;
    return new PGliteDriverAdapter(db);
  }

  async connectToShadowDb(): Promise<PGliteDriverAdapter> {
    // No separate shadow database in this minimal adapter — migrations are
    // applied directly (see scripts/migrate-pglite.mjs), not through
    // Prisma's own migrate-dev shadow-DB diffing flow.
    return this.connect();
  }
}

let sharedInstance: PGlite | null = null;
let migrated = false;

/**
 * Applies every migration under prisma/migrations/ to the given PGlite
 * instance via its native (non-socket) query interface, replaying the
 * real, unmodified migration SQL — skipping only the one PGlite-specific
 * `CREATE EXTENSION pgcrypto` statement documented in Phase 16's gap
 * register. The migration file on disk is never modified.
 */
async function applyMigrations(db: PGlite): Promise<{ applied: number; skipped: number }> {
  const migrationsDir = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
  const folders = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  let applied = 0;
  let skipped = 0;
  for (const folder of folders) {
    const sql = readFileSync(join(migrationsDir, folder, 'migration.sql'), 'utf-8');
    const statements = sql
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      if (/CREATE EXTENSION IF NOT EXISTS "pgcrypto"/i.test(statement)) {
        skipped += 1;
        continue;
      }
      await db.exec(statement);
      applied += 1;
    }
  }
  return { applied, skipped };
}

/**
 * Returns the process-wide shared PGlite instance, creating and migrating
 * it exactly once (idempotent — safe to call from every request's
 * `factory.connect()`). Used only when USE_PGLITE_ADAPTER=true
 * (config/env.ts) — never in the default/production code path.
 */
export async function getSharedPGlite(): Promise<PGlite> {
  sharedInstance ??= new PGlite();
  if (!migrated) {
    const result = await applyMigrations(sharedInstance);
    migrated = true;

    console.log(`[pglite-adapter] Migrations applied: ${String(result.applied)} statements (${String(result.skipped)} skipped).`);
  }
  return sharedInstance;
}
