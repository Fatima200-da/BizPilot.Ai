import { randomUUID } from 'node:crypto';
import type { Workspace } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../../common/errors/app-error';
import { slugify } from '../../common/utils/slug';
import { signAccessToken } from '../auth/jwt';
import { createFreeSubscriptionForWorkspace } from '../billing/subscription.service';
import { trackEvent, PRODUCT_EVENTS } from '../analytics/product-event.service';

/**
 * Phase 18: closes a real gap found via the first-customer walkthrough —
 * `POST /workspaces` was the ONLY place that ever minted a workspace-scoped
 * access token, so a returning user (login, not register) had no way to
 * resolve back into a workspace they already belong to; the frontend was
 * forced to send every login straight to onboarding, which would create a
 * DUPLICATE workspace rather than returning the user to their existing one.
 * This mirrors createWorkspace's token-minting exactly, but requires an
 * existing ACTIVE membership instead of creating one — the authorization
 * check IS the membership lookup itself (NotFoundError, not 403, for a
 * workspace the caller doesn't belong to, consistent with this codebase's
 * anti-enumeration convention elsewhere).
 */
export async function selectWorkspace(
  userId: string,
  isSystemAdmin: boolean,
  workspaceId: string
): Promise<{ workspace: Workspace; accessToken: string }> {
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, status: 'ACTIVE', deletedAt: null },
    include: { workspace: true, role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
  if (!membership || membership.workspace.deletedAt) throw new NotFoundError();

  const accessToken = signAccessToken({
    sub: userId,
    isSystemAdmin,
    workspaceId: membership.workspaceId,
    workspaceMemberId: membership.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    permissionKeys: membership.role.rolePermissions.map((rp) => rp.permission.key),
  });

  return { workspace: membership.workspace, accessToken };
}

/**
 * Workspace creation performs three things atomically, per
 * AUTH_ARCHITECTURE.md's tenancy model: create the Workspace, create the
 * creating user's OWNER WorkspaceMember row, and mint a fresh access token
 * scoped to the new workspace (a token minted before workspace creation has
 * no workspace claims and cannot access any workspace-scoped route).
 */
export async function createWorkspace(
  userId: string,
  isSystemAdmin: boolean,
  input: { name: string }
): Promise<{ workspace: Workspace; accessToken: string }> {
  const ownerRole = await prisma.role.findFirst({ where: { workspaceId: null, key: 'OWNER' } });
  if (!ownerRole) {
    throw new Error('OWNER system role is not seeded — run `npx tsx src/scripts/seed-rbac.ts` first.');
  }

  const baseSlug = slugify(input.name) || 'workspace';
  let slug = baseSlug;
  let attempt = 0;
  // Small, bounded retry loop for slug collisions rather than a DB-level
  // generated-suffix trick — acceptable at MVP write volume.
  while (await prisma.workspace.findUnique({ where: { slug } })) {
    attempt += 1;
    slug = `${baseSlug}-${randomUUID().slice(0, 6)}`;
    if (attempt > 5) break;
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const ws = await tx.workspace.create({
      data: { name: input.name, slug, ownerUserId: userId },
    });
    await tx.workspaceMember.create({
      data: {
        workspaceId: ws.id,
        userId,
        roleId: ownerRole.id,
        status: 'ACTIVE',
        moduleScope: [],
        joinedAt: new Date(),
      },
    });
    await tx.activity.create({
      data: {
        workspaceId: ws.id,
        actorUserId: userId,
        type: 'PROJECT_CREATED',
        summary: `Workspace "${ws.name}" created`,
      },
    });
    // Phase 26 Section 3: every workspace gets a real Settings row at
    // creation — never `settings = NULL` — so resumable onboarding state
    // (onboardingStep, defaulted to "workspace_created" by the schema) is
    // immediately readable, mirroring Phase 25's "never subscription =
    // NULL" invariant for the exact same reason.
    await tx.settings.create({ data: { workspaceId: ws.id } });
    return ws;
  });

  // Phase 25 Section 5: every workspace gets a deterministic initial
  // commercial state — never subscription = NULL. Replaces the pre-Phase-25
  // flat FREE_TIER_STARTER_CREDITS grant with a real Subscription row to
  // the seeded "free" SubscriptionPlan, whose aiCreditsPerMonth now drives
  // the initial credit grant (was previously a hardcoded, plan-independent 100).
  await createFreeSubscriptionForWorkspace(workspace.id, userId);

  const membership = await prisma.workspaceMember.findFirstOrThrow({
    where: { workspaceId: workspace.id, userId },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });

  const accessToken = signAccessToken({
    sub: userId,
    isSystemAdmin,
    workspaceId: workspace.id,
    workspaceMemberId: membership.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    permissionKeys: membership.role.rolePermissions.map((rp) => rp.permission.key),
  });

  await trackEvent({ workspaceId: workspace.id, userId, eventName: PRODUCT_EVENTS.FIRST_WORKSPACE_CREATED });

  return { workspace, accessToken };
}

export async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, deletedAt: null } });
  if (!workspace) throw new NotFoundError();
  return workspace;
}

export async function listMyWorkspaces(userId: string): Promise<Workspace[]> {
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, status: 'ACTIVE', deletedAt: null },
    include: { workspace: true },
  });
  return memberships.map((m) => m.workspace).filter((w) => !w.deletedAt);
}
