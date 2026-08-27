import type { Contact, Lead, Prisma } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { InvalidStateTransitionError, NotFoundError } from '../../common/errors/app-error';
import { paginate, type Page } from '../../common/utils/pagination';
import type {
  CreateContactInput,
  CreateLeadInput,
  UpdateContactInput,
  UpdateLeadInput,
} from './crm.validation';

type ContactWithLeads = Prisma.ContactGetPayload<{ include: { leads: true } }>;
type LeadWithContact = Prisma.LeadGetPayload<{ include: { contact: true } }>;

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export async function createContact(workspaceId: string, input: CreateContactInput): Promise<Contact> {
  return prisma.contact.create({ data: { workspaceId, ...input } });
}

export async function listContacts(
  workspaceId: string,
  opts: { search?: string; limit: number; cursor?: string }
): Promise<Page<Contact>> {
  const where: Prisma.ContactWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(opts.search
      ? {
          OR: [
            { fullName: { contains: opts.search, mode: 'insensitive' } },
            { phone: { contains: opts.search } },
            { email: { contains: opts.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const rows = await prisma.contact.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  return paginate(rows, opts.limit);
}

/** Matches PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 13.1 step 2: phone-number lookup for inbound-message identification. */
export async function matchContactByPhone(workspaceId: string, phone: string): Promise<Contact | null> {
  return prisma.contact.findFirst({ where: { workspaceId, phone, deletedAt: null } });
}

export async function getContact(workspaceId: string, id: string): Promise<ContactWithLeads> {
  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId, deletedAt: null },
    include: { leads: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } },
  });
  if (!contact) throw new NotFoundError();
  return contact;
}

export async function updateContact(workspaceId: string, id: string, input: UpdateContactInput): Promise<Contact> {
  await getContact(workspaceId, id);
  return prisma.contact.update({ where: { id }, data: input });
}

export async function deleteContact(workspaceId: string, id: string): Promise<void> {
  await getContact(workspaceId, id);
  await prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const VALID_LEAD_TRANSITIONS: Record<string, string[]> = {
  NEW: ['CONTACTED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['WON', 'LOST'],
  WON: [],
  LOST: ['NEW'], // re-opening a lost lead is a legitimate, explicit action
};

export async function createLead(workspaceId: string, input: CreateLeadInput): Promise<Lead> {
  const contact = await prisma.contact.findFirst({ where: { id: input.contactId, workspaceId, deletedAt: null } });
  if (!contact) throw new NotFoundError();
  return prisma.lead.create({ data: { workspaceId, ...input } });
}

export async function listLeads(
  workspaceId: string,
  opts: { status?: string; limit: number; cursor?: string }
): Promise<Page<LeadWithContact>> {
  const where: Prisma.LeadWhereInput = {
    workspaceId,
    deletedAt: null,
    ...(opts.status ? { status: opts.status as 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'WON' | 'LOST' } : {}),
  };
  const rows = await prisma.lead.findMany({
    where,
    include: { contact: true },
    orderBy: { createdAt: 'desc' },
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  return paginate(rows, opts.limit);
}

export async function getLead(workspaceId: string, id: string): Promise<LeadWithContact> {
  const lead = await prisma.lead.findFirst({ where: { id, workspaceId, deletedAt: null }, include: { contact: true } });
  if (!lead) throw new NotFoundError();
  return lead;
}

/**
 * Phase 15 Section 13's explicit requirement: do not allow arbitrary state
 * transitions. `status` changes are validated against VALID_LEAD_TRANSITIONS;
 * every other field updates freely.
 */
export async function updateLead(workspaceId: string, id: string, input: UpdateLeadInput): Promise<Lead> {
  const existing = await getLead(workspaceId, id);

  if (input.status && input.status !== existing.status) {
    const allowed = VALID_LEAD_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new InvalidStateTransitionError(
        `Lead cannot transition from ${existing.status} to ${input.status}. Valid next states: ${allowed.join(', ') || 'none'}.`
      );
    }
  }

  return prisma.lead.update({ where: { id }, data: input });
}
