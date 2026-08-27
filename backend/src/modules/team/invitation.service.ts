import { randomBytes } from 'node:crypto';
import type { TeamInvite } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { ConflictError, NotFoundError, PlanLimitReachedError, ValidationError } from '../../common/errors/app-error';
import { getCurrentSubscription, assertNotDowngradeBlocked } from '../billing/subscription.service';
import { createNotification } from '../notifications/notification.service';

const INVITE_EXPIRY_DAYS = 7;

/**
 * Phase 25 Sections 10-11: workspace invitations, layered on the existing
 * `TeamInvite` model (token/expiry/status/inviter/acceptedBy already
 * modeled — no new schema needed). The critical correctness property is
 * Section 11's concurrency requirement: two simultaneous invitations for
 * the FINAL available seat must not both succeed. This is enforced with a
 * real Postgres row lock (`SELECT ... FOR UPDATE` on the Workspace row,
 * mirroring credit-ledger.service.ts's exact pattern from Phase 24) inside
 * one transaction — the second concurrent caller blocks until the first
 * commits, then re-reads an accurate, post-commit member+pending-invite
 * count.
 */
export async function inviteMember(
  workspaceId: string,
  inviterUserId: string,
  input: { email: string; roleKey: string }
): Promise<TeamInvite> {
  const role = await prisma.role.findFirst({ where: { workspaceId: null, key: input.roleKey } });
  if (!role) {
    throw new ValidationError([{ field: 'roleKey', code: 'INVALID', message: `Unknown role "${input.roleKey}".` }]);
  }

  const subscription = await getCurrentSubscription(workspaceId);
  assertNotDowngradeBlocked(subscription, 'team members');

  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const created = await prisma.$transaction(async (tx) => {
    // Row-lock the workspace for the duration of the seat-count check +
    // invite creation — the same concurrency-safety pattern Phase 24 used
    // for the credit ledger. Without this lock, two concurrent invites for
    // the last seat would both read "1 remaining" before either commits.
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId}::uuid FOR UPDATE`;

    const existingPending = await tx.teamInvite.findFirst({ where: { workspaceId, email: input.email, status: 'PENDING' } });
    if (existingPending) {
      throw new ConflictError(`A pending invitation already exists for ${input.email}.`, 'TEAM_INVITE_ALREADY_PENDING');
    }
    const existingMember = await tx.workspaceMember.findFirst({
      where: { workspaceId, status: 'ACTIVE', deletedAt: null, user: { email: input.email } },
    });
    if (existingMember) {
      throw new ConflictError(`${input.email} is already a member of this workspace.`, 'TEAM_MEMBER_ALREADY_EXISTS');
    }

    // Seat count includes ACTIVE members AND other PENDING invites — an
    // invite reserves the seat from the moment it is sent, so a burst of
    // invitations cannot collectively over-commit seats even though none
    // has been accepted yet.
    const [activeCount, pendingCount] = await Promise.all([
      tx.workspaceMember.count({ where: { workspaceId, status: 'ACTIVE', deletedAt: null } }),
      tx.teamInvite.count({ where: { workspaceId, status: 'PENDING' } }),
    ]);
    const plan = subscription.plan;
    if (plan.maxTeamSeats !== null && activeCount + pendingCount >= plan.maxTeamSeats) {
      throw new PlanLimitReachedError(
        `This workspace has reached its plan limit of ${String(plan.maxTeamSeats)} team seats (${String(activeCount)} active, ${String(pendingCount)} pending). Upgrade the plan to invite more members.`
      );
    }

    const invite = await tx.teamInvite.create({
      data: { workspaceId, email: input.email, roleId: role.id, invitedByUserId: inviterUserId, token, status: 'PENDING', expiresAt },
    });
    await tx.auditLog.create({
      data: {
        workspaceId,
        actorUserId: inviterUserId,
        action: 'CREATE',
        entityType: 'TeamInvite',
        entityId: invite.id,
        newValue: { email: input.email, roleKey: input.roleKey },
      },
    });
    return invite;
  });

  // Phase 26 Section 5: INVITATION_RECEIVED can only be created for an
  // email that already has a User account — the recipient is identified by
  // `recipientUserId`, a non-null FK. An invite to a brand-new email (the
  // common real-world case) correctly has no in-app notification to
  // deliver yet; this is an honest schema constraint, not a bug.
  const invitedUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (invitedUser) {
    await createNotification({
      workspaceId,
      recipientUserId: invitedUser.id,
      category: 'TEAM',
      type: 'INVITATION_RECEIVED',
      title: 'You\'ve been invited to a workspace',
      relatedEntityType: 'TeamInvite',
      relatedEntityId: created.id,
    });
  }

  return created;
}

export interface AcceptInvitationResult {
  workspaceId: string;
  memberId: string;
}

/**
 * Section 10: acceptance must not allow tenant switching — the workspace,
 * role, and email are entirely determined by the invite row looked up by
 * the (unguessable, single-use) token, never by anything the client
 * supplies. The accepting identity is `acceptingUserId` from the caller's
 * own authenticated session — a token cannot be redeemed "as" someone else.
 */
export async function acceptInvitation(token: string, acceptingUserId: string, acceptingUserEmail: string): Promise<AcceptInvitationResult> {
  const invite = await prisma.teamInvite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'PENDING') {
    throw new NotFoundError('Invitation not found or no longer valid.');
  }
  if (invite.expiresAt < new Date()) {
    await prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    throw new ConflictError('This invitation has expired.', 'TEAM_INVITE_EXPIRED');
  }
  if (invite.email.toLowerCase() !== acceptingUserEmail.toLowerCase()) {
    // Defense in depth: a leaked token alone is not sufficient to join as a
    // different account than the one actually invited.
    throw new NotFoundError('Invitation not found or no longer valid.');
  }

  const result = await prisma.$transaction(async (tx) => {
    const reRead = await tx.teamInvite.findUniqueOrThrow({ where: { id: invite.id } });
    if (reRead.status !== 'PENDING') {
      throw new ConflictError('This invitation has already been used.', 'TEAM_INVITE_ALREADY_USED');
    }

    const member = await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: acceptingUserId } },
      update: { roleId: invite.roleId, status: 'ACTIVE', joinedAt: new Date(), deletedAt: null, invitedByUserId: invite.invitedByUserId },
      create: {
        workspaceId: invite.workspaceId,
        userId: acceptingUserId,
        roleId: invite.roleId,
        status: 'ACTIVE',
        moduleScope: [],
        joinedAt: new Date(),
        invitedByUserId: invite.invitedByUserId,
      },
    });

    await tx.teamInvite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedByUserId: acceptingUserId } });
    await tx.auditLog.create({
      data: {
        workspaceId: invite.workspaceId,
        actorUserId: acceptingUserId,
        action: 'CREATE',
        entityType: 'WorkspaceMember',
        entityId: member.id,
        newValue: { via: 'invitation', inviteId: invite.id },
      },
    });

    return { workspaceId: invite.workspaceId, memberId: member.id };
  });

  await createNotification({
    workspaceId: invite.workspaceId,
    recipientUserId: invite.invitedByUserId,
    category: 'TEAM',
    type: 'INVITATION_ACCEPTED',
    title: `${acceptingUserEmail} accepted your invitation`,
    relatedEntityType: 'TeamInvite',
    relatedEntityId: invite.id,
  });

  return result;
}

export async function rejectInvitation(token: string, decliningUserId: string | null): Promise<void> {
  const invite = await prisma.teamInvite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'PENDING') {
    throw new NotFoundError('Invitation not found or no longer valid.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.teamInvite.update({ where: { id: invite.id }, data: { status: 'DECLINED' } });
    await tx.auditLog.create({
      data: {
        workspaceId: invite.workspaceId,
        actorUserId: decliningUserId,
        action: 'UPDATE',
        entityType: 'TeamInvite',
        entityId: invite.id,
        newValue: { status: 'DECLINED' },
      },
    });
  });
}

export async function cancelInvitation(workspaceId: string, actorUserId: string, inviteId: string): Promise<void> {
  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, workspaceId, status: 'PENDING' } });
  if (!invite) throw new NotFoundError('Invitation not found or no longer valid.');
  await prisma.$transaction(async (tx) => {
    await tx.teamInvite.update({ where: { id: invite.id }, data: { status: 'REVOKED' } });
    await tx.auditLog.create({
      data: { workspaceId, actorUserId, action: 'DELETE', entityType: 'TeamInvite', entityId: invite.id, previousValue: { status: 'PENDING' }, newValue: { status: 'REVOKED' } },
    });
  });
}

export async function listPendingInvitations(workspaceId: string): Promise<TeamInvite[]> {
  return prisma.teamInvite.findMany({ where: { workspaceId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
}
