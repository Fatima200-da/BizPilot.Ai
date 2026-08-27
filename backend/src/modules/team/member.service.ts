import type { WorkspaceMember } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, InsufficientPermissionError, NotFoundError, ValidationError } from '../../common/errors/app-error';
import { retryPendingDowngrade } from '../billing/subscription.service';

/**
 * Phase 25 Section 9: OWNER/ADMIN/MEMBER capability matrix, layered on the
 * existing 6-role RBAC system (OWNER/ADMIN/MANAGER/MEMBER/VIEWER/GUEST) —
 * `billing.manage` (OWNER-only, seed-rbac.ts) and `workspace.manage`
 * (OWNER+ADMIN) already express most of Section 9's matrix declaratively;
 * this module adds the two invariants a permission check alone cannot
 * express: the last OWNER can never be removed or demoted, and only an
 * existing OWNER can grant the OWNER role to anyone (no self-escalation).
 */

export interface MemberWithUser extends WorkspaceMember {
  user: { id: string; email: string; fullName: string; avatarUrl: string | null };
  role: { id: string; key: string; name: string };
}

export async function listMembers(workspaceId: string): Promise<MemberWithUser[]> {
  return prisma.workspaceMember.findMany({
    where: { workspaceId, deletedAt: null, status: { in: ['ACTIVE', 'INVITED', 'SUSPENDED'] } },
    include: { user: { select: { id: true, email: true, fullName: true, avatarUrl: true } }, role: { select: { id: true, key: true, name: true } } },
    orderBy: { createdAt: 'asc' },
  });
}

async function countActiveOwners(workspaceId: string): Promise<number> {
  const ownerRole = await prisma.role.findFirst({ where: { workspaceId: null, key: 'OWNER' } });
  if (!ownerRole) return 0;
  return prisma.workspaceMember.count({ where: { workspaceId, roleId: ownerRole.id, status: 'ACTIVE', deletedAt: null } });
}

export async function removeMember(workspaceId: string, actorUserId: string, targetMemberId: string): Promise<void> {
  const target = await prisma.workspaceMember.findFirst({ where: { id: targetMemberId, workspaceId, deletedAt: null }, include: { role: true } });
  if (!target) throw new NotFoundError('Member not found.');

  if (target.role.key === 'OWNER') {
    const ownerCount = await countActiveOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new ConflictError('Cannot remove the last owner of a workspace.', 'TEAM_LAST_OWNER_PROTECTED');
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.update({ where: { id: target.id }, data: { status: 'REMOVED', deletedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'DELETE',
        entityType: 'WorkspaceMember',
        entityId: target.id,
        previousValue: { status: target.status, roleKey: target.role.key },
        newValue: { status: 'REMOVED' },
      },
    });
  });

  // Opportunistically resolve a DOWNGRADE_PENDING subscription now that the
  // workspace may be compliant again — no separate user action required.
  await retryPendingDowngrade(workspaceId, actorUserId).catch(() => undefined);
}

export async function changeMemberRole(workspaceId: string, actorUserId: string, actorMemberId: string, targetMemberId: string, newRoleKey: string): Promise<WorkspaceMember> {
  const [actor, target, newRole] = await Promise.all([
    prisma.workspaceMember.findFirst({ where: { id: actorMemberId, workspaceId, deletedAt: null }, include: { role: true } }),
    prisma.workspaceMember.findFirst({ where: { id: targetMemberId, workspaceId, deletedAt: null }, include: { role: true } }),
    prisma.role.findFirst({ where: { workspaceId: null, key: newRoleKey } }),
  ]);
  if (!target) throw new NotFoundError('Member not found.');
  if (!newRole) throw new ValidationError([{ field: 'roleKey', code: 'INVALID', message: `Unknown role "${newRoleKey}".` }]);
  if (!actor) throw new NotFoundError('Acting member not found.');

  // Section 9: only an existing OWNER may grant the OWNER role — prevents
  // an ADMIN (who can otherwise manage members) from self-escalating or
  // escalating anyone else to OWNER.
  if (newRole.key === 'OWNER' && actor.role.key !== 'OWNER') {
    throw new InsufficientPermissionError('Only an existing workspace owner can grant the OWNER role.');
  }

  // Prevent demoting the last OWNER — same invariant as removal.
  if (target.role.key === 'OWNER' && newRole.key !== 'OWNER') {
    const ownerCount = await countActiveOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new ConflictError('Cannot demote the last owner of a workspace.', 'TEAM_LAST_OWNER_PROTECTED');
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.workspaceMember.update({ where: { id: target.id }, data: { roleId: newRole.id } });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId,
        action: 'PERMISSION_CHANGE',
        entityType: 'WorkspaceMember',
        entityId: target.id,
        previousValue: { roleKey: target.role.key },
        newValue: { roleKey: newRole.key },
      },
    });
    return updated;
  });
}
