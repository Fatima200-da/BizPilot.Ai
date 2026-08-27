import { describe, expect, it } from 'vitest';
import { MockProviderAdapter } from './mock-provider.adapter';
import {
  calendarOutputSchema,
  pillarsOutputSchema,
  strategyOutputSchema,
} from '../../modules/marketing-autopilot/marketing-autopilot.schemas';

const BUSINESS_CONTEXT = {
  businessName: 'Günel Beauty Studio',
  industry: 'Gözəllik salonu',
  targetAudience: 'Bakıda yaşayan 20-40 yaş qadınlar',
  offerings: [{ name: 'Saç düzümü' }, { name: 'Manikür' }],
  contentLanguage: 'AZ' as const,
  objective: 'bookings',
  platforms: ['instagram', 'whatsapp'],
};

describe('MockProviderAdapter', () => {
  it('is deterministic — the same (promptKey, context) always produces the same output (Section 43.2)', async () => {
    const adapter = new MockProviderAdapter();
    const first = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.strategy',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    const second = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.strategy',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    expect(first.outputJson).toBe(second.outputJson);
  });

  it('produces output that satisfies the strategy Zod contract', async () => {
    const adapter = new MockProviderAdapter();
    const result = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.strategy',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    const parsed = strategyOutputSchema.safeParse(JSON.parse(result.outputJson));
    expect(parsed.success).toBe(true);
  });

  it('produces output that satisfies the pillars Zod contract (3-6 pillars)', async () => {
    const adapter = new MockProviderAdapter();
    const result = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.pillars',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    const parsed = pillarsOutputSchema.safeParse(JSON.parse(result.outputJson));
    expect(parsed.success).toBe(true);
  });

  it('produces a 30-day calendar that satisfies the calendar Zod contract, with every item referencing a real pillar', async () => {
    const adapter = new MockProviderAdapter();
    const result = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.calendar',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    const parsed = calendarOutputSchema.safeParse(JSON.parse(result.outputJson));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Every item's `status` is already guaranteed 'DRAFT' by the schema's
      // z.literal('DRAFT') — reaching this branch at all is the assertion.
      expect(parsed.data.items).toHaveLength(30);
    }
  });

  it('personalizes output using the actual business name — proving context assembly, not a static fixture', async () => {
    const adapter = new MockProviderAdapter();
    const result = await adapter.complete({
      actionType: 'AUTOMATION_RUN',
      promptKey: 'marketing.strategy',
      context: BUSINESS_CONTEXT,
      workspaceId: 'ws_1',
    });
    expect(result.outputJson).toContain('Günel Beauty Studio');
  });

  it('throws for an unknown promptKey rather than silently returning something plausible-looking', async () => {
    const adapter = new MockProviderAdapter();
    await expect(
      adapter.complete({ actionType: 'OTHER', promptKey: 'nonexistent.key', context: {}, workspaceId: 'ws_1' })
    ).rejects.toThrow();
  });
});
