import { randomUUID } from 'node:crypto';
import type { Invoice, InvoiceItemType } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

/**
 * Phase 25 Section 15: invoice lifecycle independent of payment-provider
 * execution — DRAFT/OPEN/PAID/VOID/UNCOLLECTIBLE already modeled on the
 * existing `Invoice`/`InvoiceItem` (integer cents throughout, never
 * floating-point money — `amountCents`/`subtotalCents`/`totalCents` are
 * all `Int`, matching the schema's existing, correct design).
 */

export interface InvoiceLineInput {
  type: InvoiceItemType;
  description: string;
  quantity?: number;
  unitAmountCents: number;
}

async function generateUniqueInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `INV-${String(year)}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const existing = await prisma.invoice.findUnique({ where: { number: candidate } });
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate a unique invoice number after 5 attempts.');
}

/** Creates a DRAFT invoice with computed integer-cents totals — never a floating-point sum. */
export async function createInvoice(workspaceId: string, subscriptionId: string | null, lines: InvoiceLineInput[], dueAt: Date | null = null): Promise<Invoice> {
  const number = await generateUniqueInvoiceNumber();
  const items = lines.map((line) => ({ ...line, quantity: line.quantity ?? 1, amountCents: line.unitAmountCents * (line.quantity ?? 1) }));
  const subtotalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const totalCents = subtotalCents; // tax integration is out of scope without a real provider — 0 by schema default

  return prisma.invoice.create({
    data: {
      workspaceId,
      subscriptionId,
      number,
      status: 'DRAFT',
      subtotalCents,
      totalCents,
      dueAt,
      items: { create: items },
    },
    include: { items: true },
  });
}

export async function openInvoice(invoiceId: string): Promise<Invoice> {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'OPEN' } });
}

export async function markInvoicePaid(invoiceId: string): Promise<Invoice> {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID', paidAt: new Date() } });
}

export async function voidInvoice(invoiceId: string): Promise<Invoice> {
  return prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'VOID' } });
}

export async function listInvoicesForWorkspace(workspaceId: string): Promise<Invoice[]> {
  return prisma.invoice.findMany({ where: { workspaceId }, include: { items: true }, orderBy: { createdAt: 'desc' } });
}

export async function getInvoiceForWorkspace(workspaceId: string, invoiceId: string): Promise<Invoice | null> {
  return prisma.invoice.findFirst({ where: { id: invoiceId, workspaceId }, include: { items: true } });
}
