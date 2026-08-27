/**
 * Phase 18: manual/browser E2E verification helper. Seeds RBAC + workflow
 * definitions and starts the HTTP server in the SAME process, required
 * because PGlite (USE_PGLITE_ADAPTER=true) is in-memory-per-process — a
 * separate `seed-rbac.ts` invocation would seed a disconnected instance.
 * Not used by production or the automated test suite (which handles this
 * via testing/integration-helpers.ts's ensureSeeded()); this script exists
 * only so a human (or Playwright) can drive the real app in a browser
 * without a networked Postgres server available.
 */
import { createApp } from '../app';
import { env } from '../config/env';
import { seedRbac } from './seed-rbac';
import { seedWorkflowDefinitions } from './seed-workflow-definitions';
import { seedSubscriptionPlans } from './seed-subscription-plans';

async function main(): Promise<void> {
  await seedRbac();
  await seedWorkflowDefinitions();
  await seedSubscriptionPlans();
  const app = createApp();
  app.listen(env.PORT, () => {
    console.log(`Dev (PGlite-seeded) server listening on :${String(env.PORT)}`);
  });
}

main().catch((err: unknown) => {
  console.error('dev-server-pglite failed:', err);
  process.exit(1);
});
