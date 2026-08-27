import { defineConfig } from 'vitest/config';

/**
 * The default `npm test` suite — fast, pure-logic unit tests only, no
 * database required (Phase 15's original 25 tests). Integration tests
 * (`*.integration.test.ts`) are excluded here and live under
 * vitest.integration.config.ts's `npm run test:integration` instead, so
 * `npm test` never silently hangs or fails waiting on a database that may
 * not be running.
 */
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**', '**/*.integration.test.ts'],
  },
});
