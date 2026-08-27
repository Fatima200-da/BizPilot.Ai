import { z } from 'zod';

/**
 * Phase 15 Section 26 ("No Fake Automation"): SCHEDULED/PUBLISHED are
 * deliberately excluded from the MVP-writable set — those states must only
 * ever be set by a real publishing integration (Part 14 of
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md, not yet built), never by a
 * direct API call pretending automation happened.
 */
export const updateContentAssetSchema = z.object({
  editedCaption: z.string().min(1).max(4000).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED']).optional(),
});

export const listContentAssetsQuerySchema = z.object({
  workflowInstanceId: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(31),
  cursor: z.string().uuid().optional(),
});

export type UpdateContentAssetInput = z.infer<typeof updateContentAssetSchema>;
export type ListContentAssetsQuery = z.infer<typeof listContentAssetsQuerySchema>;
