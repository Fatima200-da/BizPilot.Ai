/**
 * One-off operational script (BACKEND_ARCHITECTURE.md Section 14). Seeds the
 * system-defined "marketing-autopilot" WorkflowDefinition row the engine
 * looks up by key at start time (workflow-engine.service.ts). Never imported
 * by src/server.ts — run explicitly:
 *
 *   npx tsx src/scripts/seed-workflow-definitions.ts
 */
import { prisma } from '../infrastructure/database/prisma';

const STEP_GRAPH = [
  { key: 'validate_context', order: 1, kind: 'deterministic' },
  { key: 'build_strategy', order: 2, kind: 'ai' },
  { key: 'generate_pillars', order: 3, kind: 'ai' },
  { key: 'generate_calendar', order: 4, kind: 'ai' },
  { key: 'validate_output', order: 5, kind: 'deterministic' },
  { key: 'persist_assets', order: 6, kind: 'deterministic' },
  { key: 'await_approval', order: 7, kind: 'approval_gate' },
];

/** Exported so integration test setup (Phase 17) can seed within the same process/module scope as the tests themselves. Idempotent. */
export async function seedWorkflowDefinitions(): Promise<void> {
  const existing = await prisma.workflowDefinition.findFirst({
    where: { workspaceId: null, key: 'marketing-autopilot', version: 1 },
  });

  if (existing) {
    await prisma.workflowDefinition.update({
      where: { id: existing.id },
      data: { stepGraph: STEP_GRAPH, status: 'ACTIVE' },
    });
    console.log('Updated existing marketing-autopilot v1 definition.');
    return;
  }

  await prisma.workflowDefinition.create({
    data: {
      workspaceId: null,
      key: 'marketing-autopilot',
      name: 'Create My Monthly Marketing Plan',
      description: 'Business -> audience -> objective -> strategy -> content -> measurement, per Phase 15 Section 3.',
      version: 1,
      isSystemDefined: true,
      status: 'ACTIVE',
      stepGraph: STEP_GRAPH,
    },
  });
  console.log('Created marketing-autopilot v1 definition.');
}

if (require.main === module) {
  seedWorkflowDefinitions()
    .then(() => prisma.$disconnect())
    .catch(async (err: unknown) => {
      console.error('Workflow definition seed failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
