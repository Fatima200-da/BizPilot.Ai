import { Router } from 'express';
import { authenticate, requireWorkspaceContext } from '../../common/middlewares/auth';
import { authorize } from '../../common/middlewares/authorize';
import { validateBody, validateQuery } from '../../common/middlewares/validate';
import {
  createContactSchema,
  createLeadSchema,
  listContactsQuerySchema,
  listLeadsQuerySchema,
  updateContactSchema,
  updateLeadSchema,
} from './crm.validation';
import {
  createContactHandler,
  createLeadHandler,
  deleteContactHandler,
  getContactHandler,
  getLeadHandler,
  listContactsHandler,
  listLeadsHandler,
  updateContactHandler,
  updateLeadHandler,
} from './crm.controller';

export const crmRouter = Router();

crmRouter.use(authenticate, requireWorkspaceContext);

crmRouter.post('/contacts', authorize('contact.manage'), validateBody(createContactSchema), createContactHandler);
crmRouter.get('/contacts', validateQuery(listContactsQuerySchema), listContactsHandler);
crmRouter.get('/contacts/:id', getContactHandler);
crmRouter.patch('/contacts/:id', authorize('contact.manage'), validateBody(updateContactSchema), updateContactHandler);
crmRouter.delete('/contacts/:id', authorize('contact.manage'), deleteContactHandler);

crmRouter.post('/leads', authorize('lead.manage'), validateBody(createLeadSchema), createLeadHandler);
crmRouter.get('/leads', validateQuery(listLeadsQuerySchema), listLeadsHandler);
crmRouter.get('/leads/:id', getLeadHandler);
crmRouter.patch('/leads/:id', authorize('lead.manage'), validateBody(updateLeadSchema), updateLeadHandler);
