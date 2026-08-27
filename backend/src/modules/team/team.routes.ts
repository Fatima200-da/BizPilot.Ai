import { Router } from 'express';
import { authenticate } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody } from '../../common/middlewares/validate';
import { invitationRateLimit } from '../../common/middlewares/rate-limit';
import { inviteMemberSchema, changeMemberRoleSchema } from './team.validation';
import {
  listMembersHandler,
  inviteMemberHandler,
  removeMemberHandler,
  changeMemberRoleHandler,
  listInvitationsHandler,
  cancelInvitationHandler,
  acceptInvitationHandler,
  rejectInvitationHandler,
} from './team.controller';

/** Mounted at /workspaces/:workspaceId/members (workspaceScoped — see app.ts). */
export const memberRouter = Router();
memberRouter.get('/', listMembersHandler);
memberRouter.post('/invite', authorize('workspace.manage'), invitationRateLimit, validateBody(inviteMemberSchema), inviteMemberHandler);
memberRouter.delete('/:id', authorize('workspace.manage'), removeMemberHandler);
memberRouter.patch('/:id/role', authorize('workspace.manage'), validateBody(changeMemberRoleSchema), changeMemberRoleHandler);

/** Mounted at /workspaces/:workspaceId/invitations (workspaceScoped). */
export const workspaceInvitationRouter = Router();
workspaceInvitationRouter.get('/', authorize('workspace.manage'), listInvitationsHandler);
workspaceInvitationRouter.delete('/:id', authorize('workspace.manage'), cancelInvitationHandler);

/**
 * Mounted at top-level /invitations (apiRouter, NOT workspace-scoped — see
 * team.controller.ts's doc comment on acceptInvitationHandler for why).
 */
export const invitationActionRouter = Router();
invitationActionRouter.use(authenticate);
invitationActionRouter.post('/:token/accept', acceptInvitationHandler);
invitationActionRouter.post('/:token/reject', rejectInvitationHandler);
