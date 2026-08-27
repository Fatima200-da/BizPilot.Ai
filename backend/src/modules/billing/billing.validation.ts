import { z } from 'zod';

export const changePlanSchema = z.object({
  planKey: z.enum(['free', 'starter', 'pro', 'business']),
});

export const cancelSubscriptionSchema = z.object({
  immediate: z.boolean().default(false),
});

export type ChangePlanInput = z.infer<typeof changePlanSchema>;
export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;
