import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Phase 24 Section 9: unit test for THIS APPLICATION'S OWN error-redaction
 * code in `openai.adapter.ts` — NOT a test of the real OpenAI provider
 * (REAL_AI_PROVIDER remains BLOCKED — CREDENTIAL; this test never contacts
 * api.openai.com). The `openai` SDK's `chat.completions.create` is mocked
 * to throw a synthetic error whose message contains a sensitive-looking
 * string, purely to prove the adapter's catch block (fixed this phase —
 * see docs/PHASE_24_AI_ARCHITECTURE_AUDIT.md) never relays a third-party
 * SDK's raw error text into the client-facing `UpstreamProviderError`.
 * Placeholder credential value below is an obviously-fake, non-functional
 * string used only to satisfy the adapter constructor's truthiness check —
 * never sent anywhere, since the SDK call itself is mocked out entirely.
 */
const FAKE_NON_FUNCTIONAL_KEY = 'test-placeholder-not-a-real-key';

let lastConstructorArgs: unknown = null;

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(args: unknown) {
        lastConstructorArgs = args;
      }
      chat = {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Incorrect API key provided: sk-leaked-secret-detail-xyz. Organization org-sensitive123 not found.')),
        },
      };
    },
  };
});

describe('OpenAIAdapter error redaction (local code, not provider behavior)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('never relays the raw SDK error message to the client-facing error', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', FAKE_NON_FUNCTIONAL_KEY);

    const { OpenAIAdapter } = await import('./openai.adapter');
    const { UpstreamProviderError } = await import('../../common/errors/app-error');
    const adapter = new OpenAIAdapter();

    await expect(
      adapter.complete({ actionType: 'AUTOMATION_RUN', promptKey: 'marketing.strategy', context: {}, workspaceId: 'ws-test' })
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UpstreamProviderError);
      const message = (err as Error).message;
      expect(message).not.toMatch(/sk-leaked-secret-detail-xyz|org-sensitive123|Incorrect API key/);
      return true;
    });

    vi.unstubAllEnvs();
  });

  it('Phase 34 Track E: real timeout and retry configuration is actually passed to the SDK client, not left implicit', async () => {
    vi.stubEnv('AI_PROVIDER', 'openai');
    vi.stubEnv('OPENAI_API_KEY', FAKE_NON_FUNCTIONAL_KEY);
    vi.stubEnv('AI_PROVIDER_TIMEOUT_MS', '12345');

    const { OpenAIAdapter } = await import('./openai.adapter');
    lastConstructorArgs = null;
    new OpenAIAdapter(); // constructing is the assertion; the instance itself is not used

    expect(lastConstructorArgs).toMatchObject({ timeout: 12345, maxRetries: 2 });

    vi.unstubAllEnvs();
  });
});
