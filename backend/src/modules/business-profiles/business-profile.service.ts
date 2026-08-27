import type { BusinessProfile } from '@prisma/client';
import { prisma } from '../../infrastructure/database/prisma';
import { NotFoundError } from '../../common/errors/app-error';
import type { CreateBusinessProfileInput, UpdateBusinessProfileInput } from './business-profile.validation';

export async function createBusinessProfile(workspaceId: string, input: CreateBusinessProfileInput): Promise<BusinessProfile> {
  const existingCount = await prisma.businessProfile.count({ where: { workspaceId, deletedAt: null } });
  return prisma.businessProfile.create({
    data: {
      workspaceId,
      name: input.name,
      industry: input.industry,
      description: input.description,
      targetAudience: input.targetAudience,
      voiceNotes: input.voiceNotes,
      website: input.website,
      offerings: input.offerings ?? [],
      socialLinks: input.socialLinks ?? [],
      contentLanguage: input.contentLanguage,
      isDefault: existingCount === 0,
    },
  });
}

export async function listBusinessProfiles(workspaceId: string): Promise<BusinessProfile[]> {
  return prisma.businessProfile.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getBusinessProfile(workspaceId: string, id: string): Promise<BusinessProfile> {
  const profile = await prisma.businessProfile.findFirst({ where: { id, workspaceId, deletedAt: null } });
  if (!profile) throw new NotFoundError();
  return profile;
}

export async function updateBusinessProfile(
  workspaceId: string,
  id: string,
  input: UpdateBusinessProfileInput
): Promise<BusinessProfile> {
  await getBusinessProfile(workspaceId, id); // 404s if missing or cross-tenant
  return prisma.businessProfile.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.industry !== undefined ? { industry: input.industry } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.targetAudience !== undefined ? { targetAudience: input.targetAudience } : {}),
      ...(input.voiceNotes !== undefined ? { voiceNotes: input.voiceNotes } : {}),
      ...(input.website !== undefined ? { website: input.website } : {}),
      ...(input.offerings !== undefined ? { offerings: input.offerings } : {}),
      ...(input.socialLinks !== undefined ? { socialLinks: input.socialLinks } : {}),
      ...(input.contentLanguage !== undefined ? { contentLanguage: input.contentLanguage } : {}),
    },
  });
}
