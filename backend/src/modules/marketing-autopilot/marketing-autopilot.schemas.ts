import { z } from 'zod';

/**
 * Phase 15 Section 9's "Structured AI Contract": every AI operation's raw
 * output is parsed and validated against one of these schemas before it is
 * ever persisted. A response that fails validation is a FAILED step
 * (Section 15 — malformed AI output is a permanent, not transient, failure
 * and is never blindly retried), never silently coerced or persisted as
 * trusted business data.
 */

export const strategyOutputSchema = z.object({
  objective: z.string().min(1),
  audience: z.string().min(1),
  positioning: z.string().min(1),
  campaignThemes: z.array(z.string().min(1)).min(1),
  ctaStrategy: z.string().min(1),
  recommendedFormats: z.array(z.string().min(1)).min(1),
  frequency: z.string().min(1),
  successIndicators: z.array(z.string().min(1)).min(1),
});

export const pillarsOutputSchema = z.object({
  pillars: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        description: z.string().min(1),
        rationale: z.string().min(1),
      })
    )
    .min(3)
    .max(6),
});

export const calendarItemSchema = z.object({
  day: z.number().int().min(1).max(31),
  platform: z.string().min(1),
  contentType: z.string().min(1),
  pillarKey: z.string().min(1),
  topic: z.string().min(1),
  hook: z.string().min(1),
  keyMessage: z.string().min(1),
  caption: z.string().min(1),
  cta: z.string().min(1),
  visualDirection: z.string().min(1),
  status: z.literal('DRAFT'),
});

export const calendarOutputSchema = z.object({
  items: z.array(calendarItemSchema).min(28).max(31),
});

export const startMarketingAutopilotSchema = z.object({
  businessProfileId: z.string().uuid(),
  objective: z.enum(['awareness', 'bookings', 'sales']).default('bookings'),
  platforms: z.array(z.string().min(1)).min(1).max(5).default(['instagram']),
  idempotencyKey: z.string().max(200).optional(),
});

export type StrategyOutput = z.infer<typeof strategyOutputSchema>;
export type PillarsOutput = z.infer<typeof pillarsOutputSchema>;
export type CalendarOutput = z.infer<typeof calendarOutputSchema>;
export type StartMarketingAutopilotInput = z.infer<typeof startMarketingAutopilotSchema>;
