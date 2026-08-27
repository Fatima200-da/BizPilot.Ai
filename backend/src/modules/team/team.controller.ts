import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError, ValidationError } from '../../common/errors/app-error';
import * as memberService from './member.service';
import * as invitationService from './invitation.service';

export const listMembersHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const members = await memberService.listMembers(auth.workspaceId);
  sendData(res, members);
});

export const inviteMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { email: string; roleKey: string };
  const invite = await invitationService.inviteMember(auth.workspaceId, auth.userId, body);
  sendData(res, { id: invite.id, email: invite.email, status: invite.status, expiresAt: invite.expiresAt }, 201);
});

export const listInvitationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const invites = await invitationService.listPendingInvitations(auth.workspaceId);
  sendData(res, invites.map((i) => ({ id: i.id, email: i.email, status: i.status, expiresAt: i.expiresAt, createdAt: i.createdAt })));
});

export const cancelInvitationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  await invitationService.cancelInvitation(auth.workspaceId, auth.userId, req.params.id as string);
  res.status(204).send();
});

export const removeMemberHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  await memberService.removeMember(auth.workspaceId, auth.userId, req.params.id as string);
  res.status(204).send();
});

export const changeMemberRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const body = req.body as { roleKey: string };
  if (!body.roleKey) throw new ValidationError([{ field: 'roleKey', code: 'REQUIRED', message: 'roleKey is required.' }]);
  const updated = await memberService.changeMemberRole(auth.workspaceId, auth.userId, auth.workspaceMemberId, req.params.id as string, body.roleKey);
  sendData(res, updated);
});

/** Not workspace-scoped — the accepting user may have no membership in this workspace yet; the token itself is the authorization for WHICH workspace/role, per Section 10's "must not allow tenant switching". */
export const acceptInvitationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user) throw new NotFoundError();
  const result = await invitationService.acceptInvitation(req.params.token as string, auth.userId, user.email);
  sendData(res, result);
});

export const rejectInvitationHandler = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  await invitationService.rejectInvitation(req.params.token as string, auth.userId);
  res.status(204).send();
});
