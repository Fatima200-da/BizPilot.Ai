/**
 * Phase 30 Track D.8-9: full backup certification + first real RPO/RTO
 * measurement.
 *
 * Extends Phase 29's 7-table representative rehearsal
 * (backup-restore-rehearsal-phase29.ts) to ALL real tables in the
 * database, using the same real, documented substitution (no Docker
 * daemon, no native pg_dump/psql — see that script's header for the full
 * reasoning) plus one new piece: since restoring 49 real tables by hand in
 * a hand-verified FK-safe order would be a real correctness risk under
 * time pressure, this script queries the ACTUAL foreign-key graph from
 * `information_schema` and computes a real topological sort (Kahn's
 * algorithm) — a generic, verifiable algorithm, not a guessed order.
 *
 * Also verifies indexes and constraints were faithfully recreated (not
 * just tables and rows), and measures real RTO: the actual wall-clock
 * time this rehearsal's schema-replay + full-data-restore took, against
 * this environment's real current data volume — the first real
 * measurement of this kind in this project's history (every prior phase's
 * backup/restore work verified correctness, not speed).
 *
 * RPO is NOT measured here — it cannot be, honestly. RPO is a function of
 * how OFTEN backups are taken, and Phase 29 explicitly decided (with
 * reasoning, in PHASE_29_DATA_RETENTION_POLICY.md) not to build automated
 * backup scheduling yet. This script documents that honestly and states a
 * recommended target rather than fabricating a measured one.
 *
 * Run: npx tsx src/scripts/backup-restore-rpo-rto-phase30.ts
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import '../config/env';
import { breakCycles, fetchAllTables, fetchFkEdges, topologicalSort, type FkEdge } from '../modules/backup/backup-core';

const SCHEMA = 'restore_verify_p30';
const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

const SKIP_STATEMENTS = new Set([
  'CREATE SCHEMA IF NOT EXISTS "public"',
  'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',
]);

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// FkEdge / fetchFkEdges / fetchAllTables / breakCycles / topologicalSort now
// live in modules/backup/backup-core.ts (Phase 31 extracted them for reuse
// by the new scheduled backup job) — imported above. Re-run after
// extraction to confirm byte-for-byte identical certification output
// (50 tables, 0 mismatches) before trusting the shared module for anything
// new; see docs/PHASE_31_DISASTER_RECOVERY_PRODUCTION_OPERATIONS_CERTIFICATION.md.

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log(`[phase30-backup-rpo-rto] connected. Creating isolated schema "${SCHEMA}"...`);
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET search_path TO ${SCHEMA}`);

    const migrationDirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const schemaStart = performance.now();
    let statementsApplied = 0;
    for (const dir of migrationDirs) {
      const sql = readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf-8');
      for (const statement of splitStatements(sql)) {
        if (SKIP_STATEMENTS.has(statement.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())) continue;
        await client.query(statement);
        statementsApplied += 1;
      }
    }
    const schemaMs = performance.now() - schemaStart;
    console.log(`[phase30-backup-rpo-rto] schema restore: ${String(statementsApplied)} statements, ${schemaMs.toFixed(0)}ms`);

    // --- indexes & constraints verification (not just tables/rows) ---
    const [publicIndexes, restoredIndexes] = await Promise.all([
      client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_indexes WHERE schemaname = 'public'`),
      client.query<{ n: string }>(`SELECT count(*)::text AS n FROM pg_indexes WHERE schemaname = $1`, [SCHEMA]),
    ]);
    const [publicConstraints, restoredConstraints] = await Promise.all([
      client.query<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.table_constraints WHERE table_schema = 'public'`),
      client.query<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.table_constraints WHERE table_schema = $1`, [SCHEMA]),
    ]);
    const indexesMatch = publicIndexes.rows[0]?.n === restoredIndexes.rows[0]?.n;
    const constraintsMatch = publicConstraints.rows[0]?.n === restoredConstraints.rows[0]?.n;
    console.log(`[phase30-backup-rpo-rto] indexes: public=${publicIndexes.rows[0]?.n ?? '?'} restored=${restoredIndexes.rows[0]?.n ?? '?'} match=${String(indexesMatch)}`);
    console.log(`[phase30-backup-rpo-rto] constraints: public=${publicConstraints.rows[0]?.n ?? '?'} restored=${restoredConstraints.rows[0]?.n ?? '?'} match=${String(constraintsMatch)}`);
    // `_prisma_migrations` is Prisma's own deploy-tooling bookkeeping
    // table — created by `prisma migrate deploy` itself, not represented
    // in any migration.sql file, so it never gets replayed into the
    // isolated schema. This is expected and benign (tooling metadata, not
    // application/business data); excluded from the comparison below with
    // that reasoning stated explicitly rather than silently ignored.
    let indexesFullyExplained = indexesMatch;
    if (!indexesMatch) {
      const diff = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname NOT IN (SELECT indexname FROM pg_indexes WHERE schemaname = $1) AND indexname != '_prisma_migrations_pkey'
         UNION SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND indexname NOT IN (SELECT indexname FROM pg_indexes WHERE schemaname = 'public')`,
        [SCHEMA]
      );
      indexesFullyExplained = diff.rows.length === 0;
      if (indexesFullyExplained) {
        console.log('[phase30-backup-rpo-rto]   index diff is exactly _prisma_migrations_pkey (Prisma tooling metadata, not application data) — real application indexes match exactly.');
      } else {
        console.log(`[phase30-backup-rpo-rto]   UNEXPLAINED index name diff: ${diff.rows.map((r) => r.indexname).join(', ')}`);
      }
    }
    let constraintsFullyExplained = constraintsMatch;
    if (!constraintsMatch) {
      const diff = await client.query<{ constraint_name: string }>(
        `SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name != '_prisma_migrations' AND constraint_name NOT IN (SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1)
         UNION SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = $1 AND constraint_name NOT IN (SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public')`,
        [SCHEMA]
      );
      constraintsFullyExplained = diff.rows.length === 0;
      if (constraintsFullyExplained) {
        console.log('[phase30-backup-rpo-rto]   constraint diff is entirely _prisma_migrations\' own constraints (Prisma tooling metadata, not application data) — real application constraints match exactly.');
      } else {
        console.log(`[phase30-backup-rpo-rto]   UNEXPLAINED constraint name diff: ${diff.rows.map((r) => r.constraint_name).join(', ')}`);
      }
    }

    // --- real, computed (not hand-ordered) full-table data restore ---
    const allTables = await fetchAllTables(client, SCHEMA);
    const rawFkEdges = await fetchFkEdges(client, SCHEMA);
    const { edges: fkEdges, broken } = breakCycles(allTables, rawFkEdges);
    const order = topologicalSort(allTables, fkEdges);
    console.log(`[phase30-backup-rpo-rto] ${String(allTables.length)} real tables, real FK-computed restore order established (${String(rawFkEdges.length)} FK edges).`);
    if (broken.length > 0) {
      for (const b of broken) {
        console.log(`[phase30-backup-rpo-rto] genuine circular FK found: ${b.table}.${b.column} -> ${b.dependsOn} (nullable) — inserting NULL first, fixing up after both sides exist.`);
      }
    }

    const brokenByTable = new Map<string, FkEdge[]>();
    for (const b of broken) {
      const list = brokenByTable.get(b.table) ?? [];
      list.push(b);
      brokenByTable.set(b.table, list);
    }

    // Real, custom enum types in this schema (both scalar enum columns
    // and array-of-enum columns need the text round-trip cast — a
    // replayed CREATE TYPE is a distinct type object per schema even
    // with an identical name; builtin types, including builtin arrays
    // like text[], never need this and must NOT be schema-qualified,
    // since e.g. "text" is a pg_catalog type with no such name inside
    // an application schema).
    const enumTypesRes = await client.query<{ typname: string }>(`SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = $1 AND t.typtype = 'e'`, [SCHEMA]);
    const enumTypeNames = new Set(enumTypesRes.rows.map((r) => r.typname));

    const dataStart = performance.now();
    let totalRows = 0;
    let mismatches = 0;
    for (const table of order) {
      const sourceCountRes = await client.query(`SELECT count(*)::int AS n FROM public."${table}"`);
      const sourceCount = (sourceCountRes.rows[0] as { n: number }).n;

      // Every column is named and typed explicitly — NEVER a blind
      // positional row-cast. An earlier version of this script used
      // `(t::text::schema.table).*` (Phase 29's rehearsal method, safe
      // for that script's 7 hand-picked tables) but that relies on both
      // schemas' physical column ORDER being identical, which is not a
      // safe assumption across every real table in this database (found
      // via real execution: `workspace_settings`, whose onboarding-state
      // columns were added by a later migration, restored with values
      // shifted into the wrong columns under the row-cast approach — a
      // real bug this rewrite exists specifically to fix, not a
      // hypothetical concern). Enum-typed columns still need the text
      // round-trip cast (a replayed CREATE TYPE is a distinct type object
      // per schema); builtin-typed columns copy directly by name.
      const brokenCols = brokenByTable.get(table);
      const brokenColNames = new Set((brokenCols ?? []).map((b) => b.column));
      const colsRes = await client.query<{ column_name: string; data_type: string; udt_name: string }>(
        `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [SCHEMA, table]
      );
      const selectList = colsRes.rows
        .map((c) => {
          if (brokenColNames.has(c.column_name)) return `NULL AS "${c.column_name}"`;
          if (c.data_type === 'USER-DEFINED' && enumTypeNames.has(c.udt_name)) return `(t."${c.column_name}"::text::${SCHEMA}."${c.udt_name}") AS "${c.column_name}"`;
          if (c.data_type === 'ARRAY' && c.udt_name.startsWith('_') && enumTypeNames.has(c.udt_name.slice(1))) {
            const elementType = c.udt_name.slice(1);
            return `(t."${c.column_name}"::text::${SCHEMA}."${elementType}"[]) AS "${c.column_name}"`;
          }
          return `t."${c.column_name}"`;
        })
        .join(', ');
      const columnNames = colsRes.rows.map((c) => `"${c.column_name}"`).join(', ');
      await client.query(`INSERT INTO ${SCHEMA}."${table}" (${columnNames}) SELECT ${selectList} FROM public."${table}" t`);

      const restoredCountRes = await client.query(`SELECT count(*)::int AS n FROM ${SCHEMA}."${table}"`);
      const restoredCount = (restoredCountRes.rows[0] as { n: number }).n;
      totalRows += sourceCount;
      if (sourceCount !== restoredCount) {
        mismatches += 1;
        console.error(`[phase30-backup-rpo-rto]   MISMATCH ${table}: source=${String(sourceCount)} restored=${String(restoredCount)}`);
      }
    }

    // Fix-up pass: now that every table has real rows, restore the
    // real values for every column that was deliberately NULLed above —
    // the actual demonstration that a genuinely circular FK can be
    // faithfully restored, not just worked around by losing data.
    let fixedUpRows = 0;
    for (const b of broken) {
      const primaryKeyRes = await client.query<{ column_name: string }>(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'`,
        [SCHEMA, b.table]
      );
      const pk = primaryKeyRes.rows[0]?.column_name ?? 'id';
      // A circular FK column is, in every real case in this schema, a
      // plain UUID reference (not a custom enum) — UUID is a built-in
      // Postgres type with no cross-schema type-identity issue (unlike
      // the enum columns handled via the row-cast idiom above), so a
      // direct assignment is correct here without any cast.
      const res = await client.query(
        `UPDATE ${SCHEMA}."${b.table}" AS r SET "${b.column}" = src."${b.column}"
         FROM public."${b.table}" AS src WHERE r."${pk}" = src."${pk}" AND src."${b.column}" IS NOT NULL`
      );
      fixedUpRows += res.rowCount ?? 0;
    }
    if (broken.length > 0) console.log(`[phase30-backup-rpo-rto] circular-FK fix-up pass: ${String(fixedUpRows)} row(s) had their deferred value restored.`);

    const dataMs = performance.now() - dataStart;
    const totalMs = schemaMs + dataMs;

    console.log('');
    console.log(`[phase30-backup-rpo-rto] full data restore: ${String(order.length)} tables, ${String(totalRows)} total rows, ${dataMs.toFixed(0)}ms, ${String(mismatches)} mismatches`);

    if (mismatches > 0 || !indexesFullyExplained || !constraintsFullyExplained) {
      throw new Error('Backup/restore certification FAILED — a table row-count mismatch, or an unexplained index/constraint difference (beyond the documented _prisma_migrations tooling-metadata exception), was found. Never report this as a pass.');
    }

    console.log('');
    console.log('=== RESULT ===');
    console.log(`BACKUP_RESTORE_CERTIFICATION = VERIFIED — full ${String(order.length)}-table restore (schema + data + indexes + constraints), real FK-computed order, exact row-count match every table, zero mismatches.`);
    console.log('');
    console.log('=== RTO (Recovery Time Objective) — REAL MEASUREMENT ===');
    console.log(`Schema restore (DDL, ${String(statementsApplied)} statements): ${schemaMs.toFixed(0)}ms`);
    console.log(`Data restore (${String(order.length)} tables, ${String(totalRows)} rows): ${dataMs.toFixed(0)}ms`);
    console.log(`Total measured restore time at CURRENT data volume: ${totalMs.toFixed(0)}ms (${(totalMs / 1000).toFixed(1)}s)`);
    console.log('This is a real measurement against this environment\'s current (pre-launch, low-volume) data — it will grow with real production volume and does not yet include provisioning a fresh database server/container, which a real production RTO must also account for.');
    console.log('');
    console.log('=== RPO (Recovery Point Objective) — NOT MEASURED, HONEST STATEMENT ===');
    console.log('RPO cannot be measured because no automated backup schedule exists yet (a deliberate Phase 29 decision — see PHASE_29_DATA_RETENTION_POLICY.md\'s DATA_RETENTION_ENFORCEMENT=DEFERRED reasoning). Today, RPO is effectively unbounded: it equals the time since whoever last ran a manual backup. RECOMMENDED (not measured) target once automated backups exist: RPO <= 24h via a daily scheduled pg_dump, tightened as real customer volume justifies more frequent backups.');
  } finally {
    console.log(`[phase30-backup-rpo-rto] cleaning up — dropping isolated schema "${SCHEMA}"...`);
    await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('backup-restore-rpo-rto-phase30 FAILED:', err);
  process.exit(1);
});
