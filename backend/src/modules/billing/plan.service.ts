import type { SubscriptionPlan } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';

export async function listActivePlans(): Promise<SubscriptionPlan[]> {
  return prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
}
