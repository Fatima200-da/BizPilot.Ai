/**
 * AIProviderPort — the hexagonal port every AI-calling module depends on.
 * Implements AI_PLATFORM_ARCHITECTURE.md Section 2.3's `AIProviderPort` /
 * `BACKEND_ARCHITECTURE.md` Section 6.3's Provider Router pattern, which
 * existed on paper only until this file (Section 0.2 of
 * PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md's repository ground truth).
 *
 * Business logic (workflow steps, the Business Copilot) imports ONLY this
 * interface — never `MockProviderAdapter` or `OpenAIAdapter` directly, and
 * never the `openai` SDK. This is what Phase 15 Section 10 requires:
 * "Do not create OpenAIService/ClaudeService/GeminiService inside business
 * logic. Provider-specific implementation belongs behind the abstraction."
 */

export interface AICompletionRequest {
  /** Which structured task this call performs — ties to Prisma's AIActionType. */
  actionType: 'COPILOT_CHAT' | 'CONTENT_SHORT' | 'CONTENT_LONGFORM' | 'AUTOMATION_RUN' | 'INSIGHTS_REPORT' | 'OTHER';
  /**
   * Identifies which prompt/output-contract this call fulfills (e.g.
   * "marketing.strategy", "marketing.pillars", "marketing.calendar"). The
   * mock adapter uses this to select its deterministic fixture generator;
   * a real adapter uses it to select the correct system prompt from the
   * Prompt Registry (AI_PLATFORM_ARCHITECTURE.md Section 3.3, cited).
   */
  promptKey: string;
  /** The structured business context this call must ground its output in. */
  context: Record<string, unknown>;
  workspaceId: string;
  userId?: string;
}

export interface AICompletionResult {
  /** Raw JSON string — the caller parses and validates against its own Zod schema (Section 9's contract). */
  outputJson: string;
  provider: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface AIProviderPort {
  readonly name: string;
  complete(request: AICompletionRequest): Promise<AICompletionResult>;
}
