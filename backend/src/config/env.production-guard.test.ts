import { describe, expect, it } from 'vitest';
import { envSchema } from './env';

// Phase 21 Section 18: production must fail fast on accidental dev-config
// carryover (localhost origins, placeholder secrets, the in-memory PGlite
// adapter) — these were previously allowed to boot silently in production
// because the Zod schema had no NODE_ENV-conditional checks at all.
const validProdBase = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://bizpilot_app:realpassword@db.internal:5432/bizpilot_ai_prod',
  CORS_ORIGIN: 'https://app.bizpilot.ai',
  JWT_SECRET: 'a-genuinely-random-64-character-production-secret-value-here',
  JWT_REFRESH_SECRET: 'a-different-genuinely-random-64-character-refresh-secret-value',
};

describe('env production guard (superRefine)', () => {
  it('accepts a fully-configured production environment', () => {
    const result = envSchema.safeParse(validProdBase);
    expect(result.success).toBe(true);
  });

  it('rejects a localhost CORS_ORIGIN in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, CORS_ORIGIN: 'http://localhost:5173' });
    expect(result.success).toBe(false);
  });

  it('rejects a localhost DATABASE_URL in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev' });
    expect(result.success).toBe(false);
  });

  it('rejects a known dev-placeholder JWT_SECRET in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, JWT_SECRET: 'dev-only-secret-do-not-use-in-production' });
    expect(result.success).toBe(false);
  });

  it('rejects a known dev-placeholder JWT_REFRESH_SECRET in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, JWT_REFRESH_SECRET: 'replace-with-a-strong-random-refresh-secret' });
    expect(result.success).toBe(false);
  });

  it('rejects JWT_SECRET and JWT_REFRESH_SECRET being identical in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, JWT_REFRESH_SECRET: validProdBase.JWT_SECRET });
    expect(result.success).toBe(false);
  });

  it('rejects USE_PGLITE_ADAPTER=true in production', () => {
    const result = envSchema.safeParse({ ...validProdBase, USE_PGLITE_ADAPTER: 'true' });
    expect(result.success).toBe(false);
  });

  it('allows the same dev-placeholder secrets and localhost origins in development (no regression)', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
    });
    expect(result.success).toBe(true);
  });

  it('allows AI_PROVIDER=mock in production (documented supported mode, not a fail-fast error)', () => {
    const result = envSchema.safeParse({ ...validProdBase, AI_PROVIDER: 'mock' });
    expect(result.success).toBe(true);
  });
});

// Phase 23 Section 6: production startup failure-scenario certification —
// missing mandatory variables and malformed connection strings must fail
// fast at env validation, not deep inside a Prisma connection attempt.
describe('env fail-fast on missing/malformed mandatory variables', () => {
  it('rejects a completely missing DATABASE_URL', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = validProdBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a completely missing JWT_SECRET', () => {
    const { JWT_SECRET: _JWT_SECRET, ...rest } = validProdBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a completely missing JWT_REFRESH_SECRET', () => {
    const { JWT_REFRESH_SECRET: _JWT_REFRESH_SECRET, ...rest } = validProdBase;
    const result = envSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects a malformed DATABASE_URL (not a postgresql:// connection string)', () => {
    const result = envSchema.safeParse({ ...validProdBase, DATABASE_URL: 'not-a-connection-string' });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed DATABASE_URL (a plain file path)', () => {
    const result = envSchema.safeParse({ ...validProdBase, DATABASE_URL: '/var/lib/postgres/data' });
    expect(result.success).toBe(false);
  });

  it('rejects AI_PROVIDER=openai with no OPENAI_API_KEY', () => {
    const result = envSchema.safeParse({ ...validProdBase, AI_PROVIDER: 'openai' });
    expect(result.success).toBe(false);
  });

  it('accepts AI_PROVIDER=openai with a real-looking OPENAI_API_KEY', () => {
    const result = envSchema.safeParse({ ...validProdBase, AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-fake-key-for-schema-testing-only' });
    expect(result.success).toBe(true);
  });
});

// Phase 21 Section 18: a real bug found live this phase — `z.coerce.boolean()`
// is `Boolean(value)` under the hood, so the literal string "false" (any
// non-empty string) coerced to `true`. Explicitly setting
// USE_PGLITE_ADAPTER=false silently pointed the app at an ephemeral
// in-memory database instead of the real one configured via DATABASE_URL.
// Reproduced live: a workspace-creation request 500'd with "OWNER system
// role is not seeded" even though the role had just been seeded — because
// the running server was silently talking to a fresh, unseeded, in-process
// PGlite instance instead of the real database its DATABASE_URL pointed at.
describe('env USE_PGLITE_ADAPTER boolean parsing (regression for a live-reproduced bug)', () => {
  it('parses the literal string "false" as boolean false, not true', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
      USE_PGLITE_ADAPTER: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.USE_PGLITE_ADAPTER).toBe(false);
  });

  it('parses the literal string "true" as boolean true', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
      USE_PGLITE_ADAPTER: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.USE_PGLITE_ADAPTER).toBe(true);
  });

  it('defaults to false when the variable is entirely unset', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.USE_PGLITE_ADAPTER).toBe(false);
  });
});

// Phase 30 Track A.1: the Stripe production/test-key mismatch guards
// (env.ts's second superRefine block) had real, working validation logic
// with zero test coverage until now — a real gap, not a hypothetical one:
// a misconfigured deploy could have silently run production traffic
// through a Stripe TEST key (charging nothing, looking successful) or a
// non-production environment through a real LIVE key (charging real
// money) and neither would have been caught by anything in this suite.
describe('env Stripe production/test-key guards', () => {
  it('accepts PAYMENT_PROVIDER=stripe in production with a real-looking LIVE secret key and webhook secret', () => {
    const result = envSchema.safeParse({
      ...validProdBase,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_fake_key_for_schema_testing_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only',
    });
    expect(result.success).toBe(true);
  });

  it('rejects PAYMENT_PROVIDER=stripe with no STRIPE_SECRET_KEY', () => {
    const result = envSchema.safeParse({ ...validProdBase, PAYMENT_PROVIDER: 'stripe', STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only' });
    expect(result.success).toBe(false);
  });

  it('rejects PAYMENT_PROVIDER=stripe with a STRIPE_SECRET_KEY that does not start with "sk_"', () => {
    const result = envSchema.safeParse({
      ...validProdBase,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'not-a-real-stripe-key',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only',
    });
    expect(result.success).toBe(false);
  });

  it('rejects PAYMENT_PROVIDER=stripe with no STRIPE_WEBHOOK_SECRET', () => {
    const result = envSchema.safeParse({ ...validProdBase, PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_fake_key_for_schema_testing_only' });
    expect(result.success).toBe(false);
  });

  it('rejects PAYMENT_PROVIDER=stripe with a STRIPE_WEBHOOK_SECRET that does not start with "whsec_"', () => {
    const result = envSchema.safeParse({
      ...validProdBase,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_fake_key_for_schema_testing_only',
      STRIPE_WEBHOOK_SECRET: 'not-a-real-webhook-secret',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Stripe TEST secret key (sk_test_...) in production — would silently process zero real payments while looking configured', () => {
    const result = envSchema.safeParse({
      ...validProdBase,
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fake_key_for_schema_testing_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Stripe LIVE secret key (sk_live_...) outside production — would charge real money from a dev/staging environment', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_live_fake_key_for_schema_testing_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a Stripe TEST secret key (sk_test_...) outside production (the real, supported local/staging configuration)', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bizpilot_ai_dev',
      JWT_SECRET: 'dev-only-secret-do-not-use-in-production',
      JWT_REFRESH_SECRET: 'dev-only-refresh-secret-do-not-use-in-production',
      PAYMENT_PROVIDER: 'stripe',
      STRIPE_SECRET_KEY: 'sk_test_fake_key_for_schema_testing_only',
      STRIPE_WEBHOOK_SECRET: 'whsec_fake_secret_for_schema_testing_only',
    });
    expect(result.success).toBe(true);
  });

  it('allows PAYMENT_PROVIDER=mock in production with no Stripe keys at all (the documented supported default)', () => {
    const result = envSchema.safeParse({ ...validProdBase, PAYMENT_PROVIDER: 'mock' });
    expect(result.success).toBe(true);
  });
});
