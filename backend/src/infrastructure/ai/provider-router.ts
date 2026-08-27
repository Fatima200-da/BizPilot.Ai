import { env } from '../../config/env';
import type { AICompletionRequest, AICompletionResult, AIProviderPort } from './ai-provider.port';
import { MockProviderAdapter } from './mock-provider.adapter';
import { OpenAIAdapter } from '../openai/openai.adapter';
import { recordAiRequest } from '../../common/observability/metrics';

/**
 * Phase 19 Section 12: wraps whichever concrete adapter is selected so
 * every AI call — mock or real — is counted exactly once, at the single
 * choke point every caller already goes through. Never inspects or logs
 * `request`/`result` contents (may contain business-sensitive prompt
 * context) — only records success/failure as a count.
 */
class MeteredProviderPort implements AIProviderPort {
  readonly name: string;
  constructor(private readonly inner: AIProviderPort) {
    this.name = inner.name;
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    try {
      const result = await this.inner.complete(request);
      recordAiRequest('succeeded');
      return result;
    } catch (err) {
      recordAiRequest('failed');
      throw err;
    }
  }
}

/**
 * AI_PLATFORM_ARCHITECTURE.md Section 2.5's Dynamic Provider Selection,
 * MVP-scoped: a single-provider selection driven by env.AI_PROVIDER rather
 * than the full capability-matrix/health-based ranking that document
 * specifies for Scale horizon (Diagram in
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 42.2) — deliberately
 * simple because there is exactly one candidate provider (mock or openai)
 * at this horizon, not several to rank.
 *
 * `OpenAIAdapter` is only ever CONSTRUCTED when env.AI_PROVIDER === 'openai'
 * (its constructor is what checks for OPENAI_API_KEY and would throw) —
 * importing the class itself is side-effect-free, so the mock-only path
 * genuinely never touches the OpenAI SDK's runtime behavior, satisfying
 * Phase 15 Section 11's "no paid API key should be required" requirement.
 *
 * This is the ONLY file, besides the two adapters themselves, that knows
 * both adapters exist. Every module that needs AI capability imports
 * `getAIProvider()`, never a concrete adapter class.
 */
let cachedProvider: AIProviderPort | null = null;

export function getAIProvider(): AIProviderPort {
  if (cachedProvider) return cachedProvider;
  const concrete = env.AI_PROVIDER === 'openai' ? new OpenAIAdapter() : new MockProviderAdapter();
  cachedProvider = new MeteredProviderPort(concrete);
  return cachedProvider;
}

/** Test-only: reset the cached singleton between test cases. */
export function resetProviderCacheForTests(): void {
  cachedProvider = null;
}
