import { z } from 'zod';

const offeringSchema = z.object({ name: z.string().min(1), description: z.string().optional() });
const socialLinkSchema = z.object({ platform: z.string().min(1), url: z.string().url() });

export const createBusinessProfileSchema = z.object({
  name: z.string().min(1).max(200),
  industry: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  targetAudience: z.string().max(2000).optional(),
  voiceNotes: z.string().max(2000).optional(),
  website: z.string().url().optional(),
  offerings: z.array(offeringSchema).max(50).optional(),
  socialLinks: z.array(socialLinkSchema).max(20).optional(),
  contentLanguage: z.enum(['AZ', 'EN', 'RU']).default('AZ'),
});

export const updateBusinessProfileSchema = createBusinessProfileSchema.partial();

export type CreateBusinessProfileInput = z.infer<typeof createBusinessProfileSchema>;
export type UpdateBusinessProfileInput = z.infer<typeof updateBusinessProfileSchema>;
