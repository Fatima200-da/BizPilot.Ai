import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 18 Section 12: the first real browser-level E2E suite for
 * BizPilot.Ai. Runs against the actual backend (PGlite-native driver
 * adapter — the same real-Postgres-engine path proven throughout Phase 17
 * and 18's HTTP integration suite) and the actual Vite dev server, driving
 * real DOM interactions rather than asserting on API responses directly.
 *
 * USE_PGLITE_ADAPTER=true here is a deliberate, honestly-labeled choice:
 * this repo has no reliably reachable networked Postgres in every
 * environment it runs in, and a browser E2E suite's value is in proving the
 * frontend <-> backend <-> persistence contract end-to-end, not in re-
 * proving the database engine choice (already covered by the integration
 * suite, which DOES run against real Postgres when DATABASE_URL points at
 * one — see backend/vitest.integration.config.ts).
 */
export default defineConfig({
  testDir: './e2e',
  // Phase 28: phase28-scheduler-container.spec.ts targets the real
  // production containers directly (hardcoded baseURL, no webServer
  // dependency here) via playwright.container.config.ts — excluded from
  // this dev-server config so a normal `npx playwright test` run never
  // silently fails/times out when those containers aren't running, and
  // never truncates its real-time-execution scenarios under this config's
  // shorter default per-test timeout.
  testIgnore: ['phase28-scheduler-container.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report' }]],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx tsx src/scripts/dev-server-pglite.ts',
      cwd: './backend',
      port: 4000,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        PORT: '4000',
        USE_PGLITE_ADAPTER: 'true',
        DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
        CORS_ORIGIN: 'http://localhost:5173',
        JWT_SECRET: 'e2e-only-secret-do-not-use-in-production-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        JWT_REFRESH_SECRET: 'e2e-only-refresh-secret-do-not-use-in-production-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        JWT_EXPIRES_IN: '15m',
        JWT_REFRESH_EXPIRES_IN: '7d',
        BCRYPT_SALT_ROUNDS: '4', // fast hashing for test speed only — never production-appropriate
        RATE_LIMIT_WINDOW_MS: '900000',
        RATE_LIMIT_MAX_REQUESTS: '1000',
        UPLOAD_MAX_FILE_SIZE_MB: '10',
        UPLOAD_DIR: './uploads',
        OPENAI_API_KEY: '',
        OPENAI_MODEL: 'gpt-4o-mini',
      },
    },
    {
      command: 'npx vite --port 5173',
      cwd: './frontend',
      port: 5173,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        VITE_API_BASE_URL: 'http://localhost:4000/api/v1',
      },
    },
  ],
});
