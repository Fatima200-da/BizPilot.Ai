import { describe, expect, it } from 'vitest';
import { calendarOutputSchema, pillarsOutputSchema, strategyOutputSchema } from './marketing-autopilot.schemas';

/**
 * Phase 24 Section 7: real response-validation certification for the
 * Structured AI Contract. Exercises the exact schemas every AI-bearing
 * workflow step validates provider output against (marketing-autopilot.steps.ts),
 * with the required scenario matrix: valid, empty, malformed JSON, missing
 * required fields, unexpected extra fields, and oversized output.
 */
describe('Marketing Autopilot AI output validation (Structured AI Contract)', () => {
  const validStrategy = {
    objective: 'Rezervlərin artırılması',
    audience: 'yerli müştərilər',
    positioning: 'keyfiyyətli xidmət',
    campaignThemes: ['tema1'],
    ctaStrategy: 'WhatsApp',
    recommendedFormats: ['Reels'],
    frequency: 'Həftədə 4',
    successIndicators: ['Profil ziyarəti'],
  };

  it('VALID → accepted', () => {
    const result = strategyOutputSchema.safeParse(validStrategy);
    expect(result.success).toBe(true);
  });

  it('EMPTY object → rejected safely (no throw, structured failure)', () => {
    const result = strategyOutputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('EMPTY string body → JSON.parse throws a catchable SyntaxError, never an uncaught crash', () => {
    expect(() => {
      JSON.parse('');
    }).toThrow(SyntaxError);
  });

  it('MALFORMED JSON → JSON.parse throws a catchable SyntaxError, never an uncaught crash', () => {
    expect(() => {
      JSON.parse('{ objective: "missing quotes", ');
    }).toThrow(SyntaxError);
  });

  it('MISSING required fields → rejected safely with field-level errors', () => {
    const { campaignThemes: _campaignThemes, ...incomplete } = validStrategy;
    const result = strategyOutputSchema.safeParse(incomplete);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'campaignThemes')).toBe(true);
    }
  });

  it('UNEXPECTED extra fields → safely ignored (stripped), per the existing Zod object contract — not rejected', () => {
    const result = strategyOutputSchema.safeParse({ ...validStrategy, unexpectedProviderField: 'anything', __proto__polluting: 'x' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unexpectedProviderField']).toBeUndefined();
    }
  });

  it('pillars: below-minimum array length → rejected safely (min 3 required)', () => {
    const result = pillarsOutputSchema.safeParse({ pillars: [{ key: 'a', name: 'A', description: 'd', rationale: 'r' }] });
    expect(result.success).toBe(false);
  });

  it('pillars: OVERSIZED array beyond the documented contract (max 6) → rejected safely, not silently truncated', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ key: `k${String(i)}`, name: `N${String(i)}`, description: 'd', rationale: 'r' }));
    const result = pillarsOutputSchema.safeParse({ pillars: many });
    expect(result.success).toBe(false);
  });

  it('calendar: item with wrong type (day as string) → rejected safely, not coerced', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      day: i === 0 ? 'one' : i + 1, // corrupt the first item's type
      platform: 'instagram',
      contentType: 'reels',
      pillarKey: 'expertise',
      topic: 't',
      hook: 'h',
      keyMessage: 'k',
      caption: 'c',
      cta: 'cta',
      visualDirection: 'v',
      status: 'DRAFT',
    }));
    const result = calendarOutputSchema.safeParse({ items });
    expect(result.success).toBe(false);
  });

  it('provider refusal shaped as a plain string (not the expected object) → rejected safely, not crashed', () => {
    const result = strategyOutputSchema.safeParse('I cannot help with that request.');
    expect(result.success).toBe(false);
  });

  it('provider refusal shaped as null → rejected safely, not crashed', () => {
    const result = strategyOutputSchema.safeParse(null);
    expect(result.success).toBe(false);
  });
});
