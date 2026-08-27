import { defineConfig } from 'vitest/config';

/**
 * Phase 16 Section 21: real-PostgreSQL integration tests, separate from the
 * fast unit suite (vitest.config default / `npm test`). These tests use the
 * real `prisma` client and the real Express app (via supertest) — no mocks.
 *
 * PRECONDITION, honestly documented rather than silently assumed: a real
 * PostgreSQL database, migrated and reachable via DATABASE_URL, must be
 * running before this suite executes:
 *
 *   docker compose up -d
 *   npm run prisma:migrate:deploy
 *   npm run test:integration
 *
 * These tests could NOT be executed in the environment this phase was
 * built in (see docs/PHASE_16_GAP_REGISTER.md — PGlite, the only
 * real-Postgres-wire-protocol substitute available there, does not support
 * parameterized queries, which every one of these tests requires). They
 * are written to the same standard as the rest of this codebase and are
 * ready to run the moment a real PostgreSQL instance is available.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false, // integration tests share one database — avoid cross-test races
  },
});
