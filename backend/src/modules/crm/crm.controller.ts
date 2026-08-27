import type { Request, Response } from 'express';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendCollection, sendData, sendNoContent } from '../../common/response';
import { requireAuth } from '../../common/utils/require-auth';
import * as service from './crm.service';
import type {
  CreateContactInput,
  CreateLeadInput,
  UpdateContactInput,
  UpdateLeadInput,
} from './crm.validation';

type ValidatedQuery<T> = Request & { validatedQuery: T };

export const createContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createContact(requireAuth(req).workspaceId, req.body as CreateContactInput);
  sendData(res, result, 201);
});

export const listContactsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = (req as ValidatedQuery<{ search?: string; limit: number; cursor?: string }>).validatedQuery;
  const { data, pagination } = await service.listContacts(requireAuth(req).workspaceId, query);
  sendCollection(res, data, pagination);
});

export const getContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getContact(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const updateContactHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateContact(requireAuth(req).workspaceId, req.params.id as string, req.body as UpdateContactInput);
  sendData(res, result);
});

export const deleteContactHandler = asyncHandler(async (req: Request, res: Response) => {
  await service.deleteContact(requireAuth(req).workspaceId, req.params.id as string);
  sendNoContent(res);
});

export const createLeadHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.createLead(requireAuth(req).workspaceId, req.body as CreateLeadInput);
  sendData(res, result, 201);
});

export const listLeadsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = (req as ValidatedQuery<{ status?: string; limit: number; cursor?: string }>).validatedQuery;
  const { data, pagination } = await service.listLeads(requireAuth(req).workspaceId, query);
  sendCollection(res, data, pagination);
});

export const getLeadHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.getLead(requireAuth(req).workspaceId, req.params.id as string);
  sendData(res, result);
});

export const updateLeadHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await service.updateLead(requireAuth(req).workspaceId, req.params.id as string, req.body as UpdateLeadInput);
  sendData(res, result);
});
