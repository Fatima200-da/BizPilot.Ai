import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import type { PGliteDriverAdapter } from './pglite-adapter';

/**
 * Single process-wide Prisma client instance (BACKEND_ARCHITECTURE.md
 * Section 14's `providers/` convention: process-wide resources live outside
 * any one module). Every repository/service imports this instance rather
 * than constructing its own `PrismaClient`.
 *
 * Phase 16: connects via `@prisma/adapter-pg` (the `pg` driver) rather than
 * Prisma's own Rust wire-protocol engine — Prisma's own officially
 * supported connection mechanism, fully compatible with real PostgreSQL.
 *
 * Phase 17: `USE_PGLITE_ADAPTER=true` swaps in a hand-written PGlite
 * driver adapter instead (pglite-adapter.ts) — opt-in only, used solely to
 * obtain real-Postgres-engine verification evidence in an environment with
 * no Docker/PostgreSQL available.
 *
 * Phase 23: a real `docker run` found that `./pglite-adapter` was
 * previously a static top-level `import` — Node tried to `require()` it
 * (and its dependency `@electric-sql/pglite`, a devDependency intentionally
 * absent from the production image) at process startup regardless of
 * `USE_PGLITE_ADAPTER`'s value, crashing every production container with
 * `MODULE_NOT_FOUND` before it could even reach the env-flag check. A
 * first fix used a guarded top-level `require()`, which solved production
 * but broke the PGlite test path itself — Vitest runs source through
 * Vite's ESM transform, which intercepts `import()` but not a raw `require()`
 * call, so `require('./pglite-adapter')` couldn't resolve there. The actual
 * fix: defer the import into `connect()`/`connectToShadowDb()` via dynamic
 * `import()`, which both Node (running the compiled production build) and
 * Vite/Vitest (running TS source directly) handle correctly — and since
 * Prisma only calls `connect()` lazily, on the first real query, this also
 * means the module (and `@electric-sql/pglite`) is never even requested
 * unless a query actually executes with the flag on, not just at process
 * startup.
 */
class LazyPGliteAdapterFactory {
  readonly provider = 'postgres' as const;
  readonly adapterName = 'pglite-native-adapter';

  async connect(): Promise<PGliteDriverAdapter> {
    const { PGliteDriverAdapterFactory, getSharedPGlite } = await import('./pglite-adapter');
    return new PGliteDriverAdapterFactory(getSharedPGlite()).connect();
  }

  async connectToShadowDb(): Promise<PGliteDriverAdapter> {
    return this.connect();
  }
}

function buildAdapter(): PrismaPg | LazyPGliteAdapterFactory {
  return env.USE_PGLITE_ADAPTER ? new LazyPGliteAdapterFactory() : new PrismaPg({ connectionString: env.DATABASE_URL });
}

const adapter = buildAdapter();

export const prisma = new PrismaClient({
  adapter,
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
