import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../infrastructure/database/prisma';
import { seedRbac } from '../scripts/seed-rbac';
import { seedWorkflowDefinitions } from '../scripts/seed-workflow-definitions';
import { seedSubscriptionPlans } from '../scripts/seed-subscription-plans';
import { signAccessToken } from '../modules/auth/jwt';

let seeded = false;

/**
 * Seeds RBAC + the marketing-autopilot WorkflowDefinition within the same
 * process/module scope as the tests (required when USE_PGLITE_ADAPTER=true
 * — PGlite is in-process, so a separate subprocess would seed an entirely
 * different, unconnected database; see pglite-adapter.ts). Idempotent —
 * safe to call from every integration test file's `beforeAll`.
 */
export async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  await seedRbac();
  await seedWorkflowDefinitions();
  await seedSubscriptionPlans();
  seeded = true;
}

/**
 * Phase 16 Section 22: test data isolation. Every integration test creates
 * its users/workspaces with an email under a unique run-scoped prefix, and
 * cleanup deletes exactly that prefix's rows — one test's fixtures can
 * never collide with or contaminate another's, and repeated runs never
 * accumulate stale data.
 */
export const app = createApp();

export function uniqueEmail(label: string): string {
  return `it-${label}-${randomUUID()}@example.test`;
}

/** Narrow, test-only response shapes — avoids `any` leaking from supertest's untyped `.body`. */
export interface ApiEnvelope<T> {
  data: T;
}
export interface ApiErrorEnvelope {
  code: string;
  detail: string;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T is intentionally explicit at every call site (never inferable from `res`), not a redundant generic.
export function data<T>(res: request.Response): T {
  return (res.body as ApiEnvelope<T>).data;
}

export function errorBody(res: request.Response): ApiErrorEnvelope {
  return res.body as ApiErrorEnvelope;
}

interface AuthResponseData {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

export interface RegisteredTestUser {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export async function registerTestUser(fullName = 'Integration Test User'): Promise<RegisteredTestUser> {
  const email = uniqueEmail('user');
  const res = await request(app).post('/api/v1/auth/register').send({ email, password: 'password1234', fullName });
  if (res.status !== 201) {
    throw new Error(`registerTestUser failed: ${String(res.status)} ${JSON.stringify(res.body)}`);
  }
  const body = data<AuthResponseData>(res);
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, userId: body.user.id, email };
}

interface WorkspaceResponseData {
  workspace: { id: string };
  accessToken: string;
}

export interface TestWorkspace {
  workspaceId: string;
  accessToken: string;
}

export async function createTestWorkspace(accessToken: string, name = 'Test Workspace'): Promise<TestWorkspace> {
  const res = await request(app).post('/api/v1/workspaces').set('Authorization', `Bearer ${accessToken}`).send({ name });
  if (res.status !== 201) {
    throw new Error(`createTestWorkspace failed: ${String(res.status)} ${JSON.stringify(res.body)}`);
  }
  const body = data<WorkspaceResponseData>(res);
  return { workspaceId: body.workspace.id, accessToken: body.accessToken };
}

/**
 * Phase 18 Section 8: RBAC negative-path testing needs a member with a
 * specific, non-OWNER role in an existing workspace. No invite/accept-invite
 * API exists yet (a real, documented product gap — see gap register), so the
 * membership row is created directly via Prisma, exactly mirroring what an
 * invite-acceptance handler would eventually persist. The token is minted via
 * the actual production `signAccessToken` function used by every real login
 * and workspace-creation path — this is not a mocked or fabricated token,
 * only its origin (a direct DB write instead of an HTTP invite flow) differs
 * from the real product surface.
 */
export async function addWorkspaceMemberWithRole(
  workspaceId: string,
  userId: string,
  roleKey: string
): Promise<{ accessToken: string; workspaceMemberId: string }> {
  const role = await prisma.role.findFirstOrThrow({
    where: { workspaceId: null, key: roleKey },
    include: { rolePermissions: { include: { permission: true } } },
  });
  const membership = await prisma.workspaceMember.create({
    data: { workspaceId, userId, roleId: role.id, status: 'ACTIVE', moduleScope: [], joinedAt: new Date() },
  });
  const accessToken = signAccessToken({
    sub: userId,
    isSystemAdmin: false,
    workspaceId,
    workspaceMemberId: membership.id,
    roleId: role.id,
    roleKey: role.key,
    permissionKeys: role.rolePermissions.map((rp) => rp.permission.key),
  });
  return { accessToken, workspaceMemberId: membership.id };
}

/** Deletes every row this helper module's fixtures could have created, scoped to one test user's email. */
export async function cleanupTestUser(email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;
  const memberships = await prisma.workspaceMember.findMany({ where: { userId: user.id } });
  const workspaceIds = memberships.map((m) => m.workspaceId);
  if (workspaceIds.length > 0) {
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } }); // cascades to members/profiles/etc. per schema's onDelete: Cascade
  }
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}
