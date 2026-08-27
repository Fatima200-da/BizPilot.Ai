/**
 * Phase 17: direct Prisma-Client-level verification against the PGlite
 * adapter (infrastructure/database/pglite-adapter.ts) — real CRUD, real
 * relations, real workspace-scoped filtering, exercised through the exact
 * same Prisma Client + generated types the application uses, not a
 * hand-rolled query. This is deliberately NOT going through HTTP/Express —
 * a direct, minimal-surface-area check that the adapter itself produces
 * correct data before trusting it with the full integration test suite.
 *
 * Run with: USE_PGLITE_ADAPTER=true npx tsx src/scripts/verify-pglite-golden-path.ts
 */
import { prisma } from '../infrastructure/database/prisma';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);

  console.log(`  OK: ${message}`);
}

async function main(): Promise<void> {

  console.log('--- Seeding minimal RBAC (OWNER role only, needed for workspace creation) ---');
  const permission = await prisma.permission.create({
    data: { key: 'workspace.manage', module: 'workspace', description: 'test' },
  });
  const ownerRole = await prisma.role.create({
    data: { workspaceId: null, key: 'OWNER', name: 'Owner', type: 'SYSTEM', isDefault: false },
  });
  await prisma.rolePermission.create({ data: { roleId: ownerRole.id, permissionId: permission.id } });
  const definition = await prisma.workflowDefinition.create({
    data: {
      workspaceId: null,
      key: 'marketing-autopilot',
      name: 'Test Definition',
      version: 1,
      isSystemDefined: true,
      status: 'ACTIVE',
      stepGraph: [{ key: 'validate_context', order: 1, kind: 'deterministic' }],
    },
  });


  console.log('--- User + Workspace + Membership ---');
  const userA = await prisma.user.create({
    data: { email: 'golden-a@example.test', fullName: 'Golden Path User A', passwordHash: 'x' },
  });
  const workspaceA = await prisma.workspace.create({ data: { name: 'Workspace A', slug: 'workspace-a-golden', ownerUserId: userA.id } });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspaceA.id, userId: userA.id, roleId: ownerRole.id, status: 'ACTIVE', moduleScope: [], joinedAt: new Date() },
  });

  const userB = await prisma.user.create({
    data: { email: 'golden-b@example.test', fullName: 'Golden Path User B', passwordHash: 'x' },
  });
  const workspaceB = await prisma.workspace.create({ data: { name: 'Workspace B', slug: 'workspace-b-golden', ownerUserId: userB.id } });
  await prisma.workspaceMember.create({
    data: { workspaceId: workspaceB.id, userId: userB.id, roleId: ownerRole.id, status: 'ACTIVE', moduleScope: [], joinedAt: new Date() },
  });

  assert((await prisma.user.count()) === 2, 'exactly 2 users exist after creation');
  assert((await prisma.workspace.count()) === 2, 'exactly 2 workspaces exist after creation');


  console.log('--- Business Profile ---');
  const profile = await prisma.businessProfile.create({
    data: { workspaceId: workspaceA.id, name: 'Test Salon', industry: 'Beauty', contentLanguage: 'AZ', offerings: [{ name: 'Haircut' }] },
  });
  assert(profile.workspaceId === workspaceA.id, 'business profile correctly scoped to workspace A');


  console.log('--- CRM: Contact + Lead ---');
  const contact = await prisma.contact.create({ data: { workspaceId: workspaceA.id, fullName: 'Test Contact', source: 'MANUAL' } });
  const lead = await prisma.lead.create({ data: { workspaceId: workspaceA.id, contactId: contact.id, status: 'NEW', source: 'MANUAL' } });
  assert(lead.contactId === contact.id, 'lead correctly relates to its contact');


  console.log('--- Workflow: Instance + StepRuns + ContentAssets ---');
  const instance = await prisma.workflowInstance.create({
    data: {
      workspaceId: workspaceA.id,
      workflowDefinitionId: definition.id,
      businessProfileId: profile.id,
      triggeredByUserId: userA.id,
      status: 'RUNNING',
      input: { objective: 'bookings' },
    },
  });
  await prisma.workflowStepRun.create({
    data: { workflowInstanceId: instance.id, stepKey: 'validate_context', stepOrder: 1, status: 'SUCCEEDED', attempt: 1 },
  });
  const assets = await prisma.$transaction(
    Array.from({ length: 30 }, (_, i) =>
      prisma.contentAsset.create({
        data: {
          workspaceId: workspaceA.id,
          workflowInstanceId: instance.id,
          businessProfileId: profile.id,
          day: i + 1,
          platform: 'instagram',
          contentType: 'single_post',
          topic: `Day ${String(i + 1)}`,
          caption: `Caption for day ${String(i + 1)}`,
          status: 'DRAFT',
        },
      })
    )
  );
  assert(assets.length === 30, 'transaction created exactly 30 ContentAsset rows atomically');

  const fetchedInstance = await prisma.workflowInstance.findUniqueOrThrow({
    where: { id: instance.id },
    include: { stepRuns: true, contentAssets: true },
  });
  assert(fetchedInstance.contentAssets.length === 30, 'refetch via relation include returns all 30 assets');
  assert(fetchedInstance.stepRuns.length === 1, 'refetch via relation include returns the 1 step run');

  await prisma.workflowInstance.update({ where: { id: instance.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
  const firstAsset = assets[0];
  if (!firstAsset) throw new Error('ASSERTION FAILED: expected at least one created ContentAsset');
  const approved = await prisma.contentAsset.update({
    where: { id: firstAsset.id },
    data: { status: 'APPROVED', approvedByUserId: userA.id, approvedAt: new Date() },
  });
  assert(approved.status === 'APPROVED', 'a single content asset transitions to APPROVED correctly');


  console.log('--- Tenant isolation: real WHERE-clause filtering, not just application logic ---');
  const workspaceAContacts = await prisma.contact.findMany({ where: { workspaceId: workspaceA.id } });
  const workspaceBContacts = await prisma.contact.findMany({ where: { workspaceId: workspaceB.id } });
  assert(workspaceAContacts.length === 1, 'workspace A sees exactly its own 1 contact');
  assert(workspaceBContacts.length === 0, "workspace B sees zero of workspace A's contacts — real query-level isolation, not just apparent isolation");

  const crossTenantAttempt = await prisma.contact.findFirst({ where: { id: contact.id, workspaceId: workspaceB.id } });
  assert(crossTenantAttempt === null, 'a contact-id + wrong-workspaceId compound lookup (exactly what every service function in this codebase performs) correctly returns null');


  console.log('--- Cascade delete (Workspace -> WorkspaceMember/BusinessProfile/Contact/... onDelete: Cascade) ---');
  await prisma.workspace.delete({ where: { id: workspaceB.id } });
  assert((await prisma.workspaceMember.count({ where: { workspaceId: workspaceB.id } })) === 0, "deleting workspace B cascades to its own membership row");
  assert((await prisma.user.count()) === 2, 'deleting a workspace does NOT cascade-delete the user who owned it (correct: User is not a child of Workspace)');


  console.log('\nALL ASSERTIONS PASSED — real Prisma Client CRUD, relations, transactions, filtering, and cascades all verified against a real Postgres engine via the PGlite adapter.');
  await prisma.$disconnect();
}

main().catch((err: unknown) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
