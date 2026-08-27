import { defineConfig, devices } from '@playwright/test';

/**
 * Phase 28: temporary config for running Playwright against the REAL
 * production containers (bizpilot-backend-p28, bizpilot-scheduler-p28,
 * bizpilot-frontend-p28 — see docs/PHASE_28_PRODUCTION_AUTOMATION_PAYMENTS_CERTIFICATION.md)
 * instead of the dev webServer playwright.config.ts spins up. No
 * `webServer` block — the containers are already running (`docker ps`)
 * before this config is used; this file only points Playwright at them.
 * Mirrors Phase 23's documented `playwright.container.config.ts` pattern
 * (same idea, recreated fresh — that file was temporary and not committed).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: ['phase28-scheduler-container.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/report-container' }]],
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
