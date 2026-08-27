import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendData } from '../../common/response';
import { AuthRequiredError } from '../../common/errors/app-error';
import * as workspaceService from './workspace.service';
import type { CreateWorkspaceInput } from './workspace.validation';

export const createWorkspaceHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AuthRequiredError();
  const body = req.body as CreateWorkspaceInput;
  const result = await workspaceService.createWorkspace(req.auth.userId, req.auth.isSystemAdmin, body);
  sendData(res, result, 201);
});

export const getWorkspaceHandler = asyncHandler(async (req: Request, res: Response) => {
  const workspace = await workspaceService.getWorkspace(req.params.workspaceId as string);
  sendData(res, workspace);
});

export const listMyWorkspacesHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AuthRequiredError();
  const workspaces = await workspaceService.listMyWorkspaces(req.auth.userId);
  sendData(res, workspaces);
});

export const selectWorkspaceHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) throw new AuthRequiredError();
  const result = await workspaceService.selectWorkspace(req.auth.userId, req.auth.isSystemAdmin, req.params.workspaceId as string);
  sendData(res, result);
});
