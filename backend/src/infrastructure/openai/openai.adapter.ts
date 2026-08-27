import OpenAI from 'openai';
import { env } from '../../config/env';
import { UpstreamProviderError } from '../../common/errors/app-error';
import type { AICompletionRequest, AICompletionResult, AIProviderPort } from '../ai/ai-provider.port';
import { PROMPT_REGISTRY } from '../../modules/marketing-autopilot/prompt-registry';

/**
 * Real-provider implementation of AIProviderPort (AI_PLATFORM_ARCHITECTURE.md
 * Section 2.3). Not used by default — env.AI_PROVIDER must be explicitly set
 * to "openai" and OPENAI_API_KEY must be present (see config/env.ts and
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 42's founder-budget
 * gate). Business logic never imports this file directly — only
 * infrastructure/ai/provider-router.ts does, proving the port swap requires
 * zero workflow-code changes.
 */
export class OpenAIAdapter implements AIProviderPort {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set — cannot construct OpenAIAdapter.');
    }
    // Phase 34 Track E: `timeout` bounds how long a hung upstream request
    // can hold a server-side connection open (see env.ts's
    // AI_PROVIDER_TIMEOUT_MS doc comment for the real defect this closes).
    // `maxRetries` is the SDK's own default (2) made explicit here rather
    // than left implicit — it already retries transient failures (network
    // errors, 5xx, 429 with backoff) automatically; this line changes
    // nothing about behavior, only makes the real, relied-upon default
    // visible to a future reader instead of an unstated assumption.
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: env.AI_PROVIDER_TIMEOUT_MS, maxRetries: 2 });
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResult> {
    const start = Date.now();
    const promptDef = PROMPT_REGISTRY[request.promptKey];
    if (!promptDef) {
      throw new Error(`No Prompt Registry entry for promptKey "${request.promptKey}"`);
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: env.OPENAI_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: promptDef.systemPrompt },
          { role: 'user', content: JSON.stringify(request.context) },
        ],
      });

      const choice = completion.choices[0];
      const content = choice?.message.content;
      if (!content) {
        throw new UpstreamProviderError('OpenAI returned an empty completion.');
      }

      return {
        outputJson: content,
        provider: this.name,
        model: completion.model,
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      if (err instanceof UpstreamProviderError) throw err;
      // Phase 24 Section 9: the raw OpenAI SDK error message is never safe
      // to relay to the client — UpstreamProviderError's message becomes
      // the user-facing `detail` field in error-handler.ts, and a
      // third-party SDK's error text is not a contract this app controls
      // (it can include account/organization identifiers or other
      // provider-side detail). Log the real error server-side only; the
      // client gets a generic, safe message.
      console.error('[openai-adapter] provider request failed', { promptKey: request.promptKey, workspaceId: request.workspaceId, error: (err as Error).message });
      throw new UpstreamProviderError();
    }
  }
}
