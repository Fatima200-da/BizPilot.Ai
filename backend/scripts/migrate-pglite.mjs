#!/usr/bin/env node
/**
 * Applies the real, unmodified Prisma migration to a running
 * dev-db-pglite.mjs instance, skipping only the `CREATE EXTENSION
 * pgcrypto` statement PGlite cannot support (see dev-db-pglite.mjs's
 * doc comment). The migration FILE ON DISK IS NEVER MODIFIED — this
 * script reads it, filters one statement in memory, and applies the
 * rest verbatim. Against real PostgreSQL, use `prisma migrate deploy`
 * directly; this script exists only for the PGlite fallback path.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'prisma', 'migrations');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55432/bizpilot_ai_dev';

const migrationFolders = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const client = new pg.Client({ connectionString: DATABASE_URL });
await client.connect();

for (const folder of migrationFolders) {
  const sqlPath = join(migrationsDir, folder, 'migration.sql');
  const rawSql = readFileSync(sqlPath, 'utf-8');

  const statements = rawSql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  console.log(`[migrate-pglite] Applying ${folder} (${statements.length} statements)...`);
  let skipped = 0;
  let applied = 0;

  for (const statement of statements) {
    if (/CREATE EXTENSION IF NOT EXISTS "pgcrypto"/i.test(statement)) {
      skipped += 1;
      console.log('[migrate-pglite]   SKIPPED (PGlite has no pgcrypto extension; gen_random_uuid() is core-native, unaffected):', statement);
      continue;
    }
    await client.query(statement);
    applied += 1;
  }

  console.log(`[migrate-pglite] ${folder}: ${applied} statements applied, ${skipped} skipped.`);
}

await client.end();
console.log('[migrate-pglite] Done.');
