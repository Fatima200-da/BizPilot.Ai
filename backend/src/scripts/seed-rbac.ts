/**
 * One-off operational script (BACKEND_ARCHITECTURE.md Section 14): seeds the
 * six system Roles (Owner/Admin/Manager/Member/Viewer/Guest, per the Role
 * model's own doc comment in schema.prisma) and the MVP Permission catalog.
 * Never imported by src/server.ts — run explicitly:
 *
 *   npx tsx src/scripts/seed-rbac.ts
 *
 * Idempotent: safe to re-run (upserts by unique key).
 */
import { prisma } from '../infrastructure/database/prisma';

const PERMISSIONS = [
  { key: 'workspace.manage', module: 'workspace', description: 'Manage workspace settings and membership.' },
  { key: 'business_profile.manage', module: 'business_profile', description: 'Create and edit business profiles.' },
  { key: 'contact.manage', module: 'crm', description: 'Create, edit, and delete contacts.' },
  { key: 'lead.manage', module: 'crm', description: 'Create, edit, and delete leads.' },
  { key: 'workflow.execute', module: 'workflow', description: 'Start workflow runs (e.g. Marketing Autopilot).' },
  { key: 'workflow.approve', module: 'workflow', description: 'Approve or reject workflow-generated content.' },
  // Phase 25 Section 9: deliberately NOT granted to ADMIN — billing/subscription
  // management is an OWNER-only capability (spec's team-role matrix), distinct
  // from `workspace.manage` (members/settings), which OWNER and ADMIN both hold.
  { key: 'billing.manage', module: 'billing', description: 'Manage subscription, plan changes, and billing.' },
] as const;

const OWNER_ONLY_PERMISSION_KEYS = ['billing.manage'];
const ADMIN_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key).filter((k) => !OWNER_ONLY_PERMISSION_KEYS.includes(k));

const SYSTEM_ROLES: Array<{ key: string; name: string; permissionKeys: readonly string[] }> = [
  { key: 'OWNER', name: 'Owner', permissionKeys: PERMISSIONS.map((p) => p.key) },
  { key: 'ADMIN', name: 'Admin', permissionKeys: ADMIN_PERMISSION_KEYS },
  {
    key: 'MANAGER',
    name: 'Manager',
    permissionKeys: ['business_profile.manage', 'contact.manage', 'lead.manage', 'workflow.execute', 'workflow.approve'],
  },
  {
    key: 'MEMBER',
    name: 'Member',
    permissionKeys: ['contact.manage', 'lead.manage', 'workflow.execute'],
  },
  { key: 'VIEWER', name: 'Viewer', permissionKeys: [] },
  { key: 'GUEST', name: 'Guest', permissionKeys: [] },
];

/** Exported so integration test setup (Phase 17) can seed within the same process/module scope as the tests themselves, rather than duplicating this logic. Idempotent — safe to call from every test file's `beforeAll`. */
export async function seedRbac(): Promise<void> {
  for (const perm of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: perm.key },
      update: { module: perm.module, description: perm.description },
      create: perm,
    });
  }

  for (const roleDef of SYSTEM_ROLES) {
    const existing = await prisma.role.findFirst({
      where: { workspaceId: null, key: roleDef.key },
    });

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: { name: roleDef.name, type: 'SYSTEM', isDefault: roleDef.key === 'MEMBER' },
        })
      : await prisma.role.create({
          data: {
            workspaceId: null,
            key: roleDef.key,
            name: roleDef.name,
            type: 'SYSTEM',
            isDefault: roleDef.key === 'MEMBER',
          },
        });

    const permissions = await prisma.permission.findMany({
      where: { key: { in: [...roleDef.permissionKeys] } },
    });

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }


    console.log(`Seeded role ${roleDef.key} with ${String(permissions.length)} permission(s).`);
  }
}

if (require.main === module) {
  seedRbac()
    .then(() => {
      console.log('RBAC seed complete.');
      return prisma.$disconnect();
    })
    .catch(async (err: unknown) => {
      console.error('RBAC seed failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
