import { z } from 'zod';

export const createContactSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  source: z.enum(['WHATSAPP', 'INSTAGRAM', 'MANUAL', 'IMPORT']).default('MANUAL'),
  businessProfileId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export const updateContactSchema = createContactSchema.partial();

export const listContactsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export const createLeadSchema = z.object({
  contactId: z.string().uuid(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']).default('NEW'),
  source: z.enum(['WHATSAPP', 'INSTAGRAM', 'MANUAL', 'IMPORT']).default('MANUAL'),
  followUpAt: z.coerce.date().optional(),
  ownerUserId: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});
export const updateLeadSchema = createLeadSchema.partial().omit({ contactId: true });

export const listLeadsQuerySchema = z.object({
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
