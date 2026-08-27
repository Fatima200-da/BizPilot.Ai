import { createHash } from 'node:crypto';
import type { AICompletionRequest, AICompletionResult, AIProviderPort } from './ai-provider.port';

/**
 * MockProviderAdapter — PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section
 * 43.2's design: deterministic, structured, business-context-aware fixture
 * responses. Same (promptKey, context) always produces the same output, so
 * demos and tests are reproducible. This is NOT a language model — it is a
 * template engine that substitutes real Business Profile fields into
 * hand-authored, human-quality Azerbaijani/English/Russian copy, which is
 * enough to prove the full context-assembly -> generation -> validation ->
 * persistence chain without a paid API key (Phase 15 Section 11).
 *
 * Honesty note (Section 43.3, carried into the completion report): this
 * proves workflow *mechanics*, not AI output *quality*. A real adapter
 * (infrastructure/openai/openai.adapter.ts) implements the identical port
 * and is a pure configuration swap away — no workflow code changes.
 */
export class MockProviderAdapter implements AIProviderPort {
  readonly name = 'mock';

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const start = Date.now();
    const generator = GENERATORS[request.promptKey];
    if (!generator) {
      throw new Error(`MockProviderAdapter has no fixture generator for promptKey "${request.promptKey}"`);
    }
    const output = generator(request.context);
    // Deterministic pseudo-latency so streaming/UI code can be tested against
    // realistic timing without actually waiting seconds in test runs.
    await sleep(hashToRange(`${request.promptKey}${JSON.stringify(request.context)}`, 40, 180));

    return {
      outputJson: JSON.stringify(output),
      provider: this.name,
      model: 'mock-v1',
      inputTokens: estimateTokens(JSON.stringify(request.context)),
      outputTokens: estimateTokens(JSON.stringify(output)),
      latencyMs: Date.now() - start,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashToRange(input: string, min: number, max: number): number {
  const hash = createHash('sha256').update(input).digest();
  const n = hash.readUInt32BE(0);
  return min + (n % (max - min));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface BusinessContext {
  businessName?: string;
  industry?: string;
  targetAudience?: string;
  offerings?: Array<{ name: string; description?: string }>;
  contentLanguage?: 'AZ' | 'EN' | 'RU';
  objective?: string;
  platforms?: string[];
}

/** `idx` is always in range by construction (`hashToRange`'s modulo), but this still fails loudly instead of silently returning `undefined` if that ever stops being true. */
function pick<T>(arr: T[], seed: string, index: number): T {
  const idx = hashToRange(`${seed}${String(index)}`, 0, arr.length);
  const value = arr[idx];
  if (value === undefined) {
    throw new Error(`pick(): index ${String(idx)} out of range for array of length ${String(arr.length)}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// marketing.strategy
// ---------------------------------------------------------------------------

const OBJECTIVE_LABELS: Record<string, string> = {
  awareness: 'Tanınmanın artırılması',
  bookings: 'Rezervlərin artırılması',
  sales: 'Satışların artırılması',
};

interface StrategyFixture {
  objective: string;
  audience: string;
  positioning: string;
  campaignThemes: string[];
  ctaStrategy: string;
  recommendedFormats: string[];
  frequency: string;
  successIndicators: string[];
}

function generateStrategy(ctx: Record<string, unknown>): StrategyFixture {
  const c = ctx as BusinessContext;
  const name = c.businessName ?? 'Biznesiniz';
  const industry = c.industry ?? 'xidmət';
  const audience = c.targetAudience ?? 'yerli müştərilər';
  const objectiveKey = c.objective ?? 'bookings';
  const objectiveLabel = OBJECTIVE_LABELS[objectiveKey] ?? 'Rezervlərin artırılması';

  return {
    objective: `${objectiveLabel} — ${name} üçün növbəti 30 gün ərzində`,
    audience: `${audience}, əsasən Instagram və WhatsApp üzərindən əlaqə saxlayan yerli müştərilər`,
    positioning: `${name} ${industry} sahəsində keyfiyyətli və etibarlı xidmət təklif edən, müştəri məmnuniyyətini önə çəkən bir marka kimi mövqeləndirilir.`,
    campaignThemes: [`${name} ilə tanış olun`, 'Müştəri rəyləri və nəticələr', 'Mövsümi kampaniya', 'Xüsusi təklif həftəsi'],
    ctaStrategy: 'Hər paylaşımda WhatsApp üzərindən birbaşa yazın və ya bio linkindən rezervasiya edin çağırışı istifadə olunur.',
    recommendedFormats: ['Carousel (karusel)', 'Reels (qısa video)', 'Story (gündəlik)', 'Single post (tək şəkil)'],
    frequency: 'Həftədə 4-5 paylaşım: 2 Reels, 2 carousel, 1 tək post, gündəlik story dəstəyi ilə',
    successIndicators: [
      'Profil ziyarətlərinin artımı',
      'WhatsApp mesajlarının sayı',
      'Rezervasiya/sifariş konversiyası',
      'Saxlanma (save) və paylaşım sayı',
    ],
  };
}

// ---------------------------------------------------------------------------
// marketing.pillars
// ---------------------------------------------------------------------------

interface PillarFixture {
  key: string;
  name: string;
  description: string;
  rationale: string;
}

function generatePillars(ctx: Record<string, unknown>): { pillars: PillarFixture[] } {
  const c = ctx as BusinessContext;
  const name = c.businessName ?? 'Biznesiniz';
  const offerings = c.offerings ?? [];

  const pillars: PillarFixture[] = [
    {
      key: 'expertise',
      name: 'Peşəkarlıq və Təcrübə',
      description: `${name}-in xidmət keyfiyyətini və peşəkarlığını göstərən məzmun.`,
      rationale: 'Etibar yaradır və satın alma qərarını dəstəkləyir.',
    },
    {
      key: 'social_proof',
      name: 'Müştəri Nəticələri',
      description: 'Real müştəri rəyləri, əvvəl/sonra nümunələri, minnətdarlıq mesajları.',
      rationale: 'Sosial sübut yeni müştərilərin qərar vermə sürətini artırır.',
    },
    {
      key: 'offerings',
      name: 'Xidmət və Məhsullar',
      description:
        offerings.length > 0
          ? `${offerings
              .map((o) => o.name)
              .slice(0, 3)
              .join(', ')} kimi konkret təkliflərin təqdimatı.`
          : 'Konkret xidmət və məhsulların təqdimatı.',
      rationale: 'Auditoriyanın nə təklif olunduğunu aydın başa düşməsini təmin edir.',
    },
    {
      key: 'behind_the_scenes',
      name: 'Kadr Arxası',
      description: 'Komanda, iş prosesi və gündəlik həyatdan kadrlar.',
      rationale: 'İnsani əlaqə yaradır, markanı daha yaxın hiss etdirir.',
    },
    {
      key: 'promotions',
      name: 'Kampaniya və Təkliflər',
      description: 'Endirimlər, mövsümi kampaniyalar, məhdud müddətli təkliflər.',
      rationale: 'Birbaşa hərəkətə keçirici, qısa müddətdə konversiyanı artırır.',
    },
  ];

  return { pillars };
}

// ---------------------------------------------------------------------------
// marketing.calendar
// ---------------------------------------------------------------------------

const HOOKS = [
  'Bunu bilirdinizmi?',
  'Müştərilərimizdən biri bunu dedi:',
  'Bu həftənin favoriti',
  'Sual: Siz də bununla qarşılaşmısınız?',
  'Yeni həftə, yeni fürsət',
  'Arxa planda nə baş verir?',
];

const CONTENT_TYPES = ['carousel', 'reels', 'story', 'single_post'];

interface CalendarItemFixture {
  day: number;
  platform: string;
  contentType: string;
  pillarKey: string;
  topic: string;
  hook: string;
  keyMessage: string;
  caption: string;
  cta: string;
  visualDirection: string;
  status: 'DRAFT';
}

function generateCalendar(ctx: Record<string, unknown>): { items: CalendarItemFixture[] } {
  const c = ctx as BusinessContext;
  const name = c.businessName ?? 'Biznesiniz';
  const platforms = c.platforms && c.platforms.length > 0 ? c.platforms : ['instagram'];
  const pillars = ['expertise', 'social_proof', 'offerings', 'behind_the_scenes', 'promotions'];

  const items: CalendarItemFixture[] = Array.from({ length: 30 }, (_, i) => {
    const day = i + 1;
    const dayLabel = String(day);
    const pillarKey = pick(pillars, `${name}-pillar`, day);
    const contentType = pick(CONTENT_TYPES, `${name}-type`, day);
    const platform = pick(platforms, `${name}-platform`, day);
    const hook = pick(HOOKS, `${name}-hook`, day);
    const visualDirection =
      contentType === 'reels' ? '15-30 saniyəlik dinamik video' : contentType === 'story' ? 'Tək kadr, sadə fon' : 'Yüksək keyfiyyətli foto, marka rənglərində';

    return {
      day,
      platform,
      contentType,
      pillarKey,
      topic: `${name} — ${dayLabel}-ci gün üçün ${pillarLabel(pillarKey)} mövzusu`,
      hook,
      keyMessage: `${name} olaraq bizim ${pillarLabel(pillarKey).toLowerCase()} tərəfimizi vurğulayırıq.`,
      caption: `${hook} ${name} komandası olaraq bu gün sizinlə ${pillarLabel(pillarKey).toLowerCase()} paylaşırıq. Ətraflı məlumat üçün bio-dakı linkə keçin və ya birbaşa WhatsApp-dan yazın!`,
      cta: 'WhatsApp-dan yazın və ya profildəki linkdən keçin',
      visualDirection,
      status: 'DRAFT' as const,
    };
  });

  return { items };
}

function pillarLabel(key: string): string {
  const labels: Record<string, string> = {
    expertise: 'Peşəkarlıq',
    social_proof: 'Müştəri Nəticələri',
    offerings: 'Xidmətlərimiz',
    behind_the_scenes: 'Kadr Arxası',
    promotions: 'Xüsusi Təklif',
  };
  return labels[key] ?? key;
}

// ---------------------------------------------------------------------------
// copilot.chat — generic grounded fallback, used by the Business Copilot
// ---------------------------------------------------------------------------

function generateCopilotReply(ctx: Record<string, unknown>): { reply: string; sourceContext: string[] } {
  const c = ctx as BusinessContext;
  const name = c.businessName ?? 'sizin biznesiniz';
  return {
    reply: `${name} haqqında verdiyiniz məlumatlara əsasən: bu sual üçün konkret tövsiyə vermək üçün əlavə kontekst (yüklənmiş fayllar və ya keçmiş danışıqlar) faydalı olardı. Hazırkı profil məlumatlarınıza əsasən ümumi tövsiyə budur — məzmun planınızı və müştəri əlaqələrinizi mütəmadi olaraq nəzərdən keçirin.`,
    sourceContext: ['businessProfile'],
  };
}

const GENERATORS: Record<string, (ctx: Record<string, unknown>) => unknown> = {
  'marketing.strategy': generateStrategy,
  'marketing.pillars': generatePillars,
  'marketing.calendar': generateCalendar,
  'copilot.chat': generateCopilotReply,
};
