#!/usr/bin/env node
/**
 * Fallback local development database for contributors who cannot run
 * Docker (Phase 16, Section 23's "reach a working local instance" goal,
 * for the case Docker itself is unavailable — e.g. a locked-down machine,
 * or the sandbox this phase was originally built and verified in).
 *
 * This is NOT the recommended path — `docker compose up -d` against real
 * PostgreSQL (docker-compose.yml) is. This script starts a real Postgres
 * engine compiled to WASM (@electric-sql/pglite) and exposes it over the
 * genuine Postgres wire protocol on 127.0.0.1:55432, so Prisma / any
 * Postgres client connects exactly as it would to a real server — this is
 * a real database, not a mock or an in-memory stub.
 *
 * Known limitation, documented rather than worked around silently: PGlite
 * does not ship the `pgcrypto` extension. The schema only actually uses
 * `gen_random_uuid()`, which PostgreSQL has shipped in core since v13 and
 * works here without the extension — but the generated migration's
 * `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` statement will fail against
 * this engine specifically. Real PostgreSQL (Docker, RDS, Supabase, Neon,
 * ...) supports pgcrypto trivially; this is a WASM-sandbox limitation of
 * this fallback tool only, not a defect in the migration. Use
 * `npm run db:migrate:pglite` (not `prisma migrate deploy` directly)
 * against this database — it applies the same migration with that one
 * statement skipped, and prints exactly what it skipped and why.
 *
 * Usage:
 *   npm run db:dev:pglite       # start the server (foreground)
 *   npm run db:migrate:pglite   # in another terminal, once it's running
 */
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const PORT = Number(process.env.PGLITE_PORT ?? 55432);
const HOST = process.env.PGLITE_HOST ?? '127.0.0.1';

const db = new PGlite();
const server = new PGLiteSocketServer({ db, port: PORT, host: HOST });
await server.start();

console.log(`[dev-db-pglite] Real Postgres-wire-protocol server listening on postgresql://${HOST}:${PORT}`);
console.log('[dev-db-pglite] Point DATABASE_URL at, e.g.:');
console.log(`[dev-db-pglite]   postgresql://postgres:postgres@${HOST}:${PORT}/bizpilot_ai_dev?schema=public`);
console.log('[dev-db-pglite] (username/password/dbname are ignored by PGlite — any value works)');

process.on('SIGINT', async () => {
  await server.stop();
  await db.close();
  process.exit(0);
});
