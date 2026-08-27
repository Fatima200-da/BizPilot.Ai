import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Fail-Fast root (BACKEND_ARCHITECTURE.md Section 11.1): this is the ONLY
 * file in the codebase allowed to read `process.env` directly. Every other
 * module imports the validated `env` object below.
 */
// Phase 21 Section 18: known development-only placeholder secrets that must
// never reach a production deployment — copied verbatim from .env.example
// and backend/.env, so an operator who forgets to override them at deploy
// time fails fast instead of running production traffic through a publicly
// known JWT signing key.
const DEV_PLACEHOLDER_SECRETS = new Set([
  'dev-only-secret-do-not-use-in-production',
  'dev-only-refresh-secret-do-not-use-in-production',
  'replace-with-a-strong-random-secret',
  'replace-with-a-strong-random-refresh-secret',
]);

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;

/**
 * Phase 21 Section 18: `z.coerce.boolean()` is `Boolean(value)` under the
 * hood — any non-empty string, including the literal "false", coerces to
 * `true` (this was a real, confirmed bug found live this phase: explicitly
 * setting `USE_PGLITE_ADAPTER=false` silently became `true`, pointing the
 * app at an ephemeral in-memory database instead of the real one). This
 * helper parses "true"/"false" (case-insensitively) as their intended
 * boolean values and lets Zod fail validation on anything else, rather than
 * silently truthy-coercing an unset/garbage/typo'd value.
 */
function booleanEnvVar(defaultValue: boolean): z.ZodEffects<z.ZodTypeAny, boolean, unknown> {
  return z.preprocess((val) => {
    if (typeof val !== 'string') return val;
    const normalized = val.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return val;
  }, z.boolean().default(defaultValue));
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Phase 34 Track A: a real gap found by auditing app.ts against the
  // documented production topology (docker-compose.prod.yml) — nginx always
  // sits in front of the backend there and sets X-Forwarded-For correctly
  // (nginx.conf.template), but Express never trusted it. Without this,
  // req.ip resolves to nginx's own container IP for every real client,
  // which collapses every IP-keyed rate limit (login, register,
  // forgot-password — see rate-limit.ts) onto one shared key: one abusive
  // or misbehaving client can lock out every other real user behind the
  // same proxy. `1` = trust exactly one hop (the immediate proxy), matching
  // the one-nginx-hop topology; a deployment with more proxies (e.g. a
  // cloud load balancer in front of nginx) should raise this accordingly,
  // never blindly set it to `true` (which trusts every hop, letting a
  // client forge its own X-Forwarded-For).
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  // Phase 23 Section 6: format-validated, not just non-empty — a malformed
  // connection string previously passed this schema and only failed deep
  // inside Prisma's connection attempt, with a much less actionable error.
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .regex(/^postgres(ql)?:\/\/.+/, 'DATABASE_URL must be a valid postgresql:// connection string'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().positive().default(10),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // Phase 19 Section 11: a hard ceiling so a stalled downstream dependency
  // (AI provider, database) cannot hold a server connection open forever.
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  // Phase 19 Section 19/20: cost guardrail, distinct from generalRateLimit
  // — caps how many workflow runs (the only credit-consuming action) one
  // workspace can start per window, independent of its credit balance.
  WORKFLOW_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3600000), // 1 hour
  WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS: z.coerce.number().int().positive().default(20),

  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(10),
  UPLOAD_DIR: z.string().default('./uploads'),

  // Phase 31: automated backup job configuration. BACKUP_DIR is local disk
  // by design this phase — no real off-host/cloud storage credential is
  // available in this environment (see PHASE_31 certification doc's
  // honest BLOCKED — CREDENTIAL note); a real production deployment must
  // point this at (or additionally sync to) off-host storage before this
  // satisfies genuine disaster recovery (a single-host disk failure would
  // take the backups with it otherwise).
  BACKUP_DIR: z.string().default('./backups'),
  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  BACKUP_MIN_RETAINED: z.coerce.number().int().nonnegative().default(3),
  BACKUP_SCHEDULE_TIME: z.string().default('03:00'), // "HH:mm", UTC
  BACKUP_STALE_RUNNING_MINUTES: z.coerce.number().int().positive().default(120),

  // Phase 32 Track A: real off-site S3-compatible storage — the AWS SDK's
  // S3Client speaks the same real protocol against AWS S3, Cloudflare R2,
  // Backblaze B2, DigitalOcean Spaces, MinIO, or any other S3-compatible
  // endpoint via S3_ENDPOINT; all optional (backups still work local-disk-
  // only if unset, matching Phase 31's default). S3_FORCE_PATH_STYLE is
  // required for most non-AWS S3-compatible endpoints (path-style bucket
  // addressing, not virtual-hosted-style).
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),

  // Phase 32 Track B: real AES-256-GCM backup encryption (Node's built-in
  // `crypto`, no new runtime dependency). Optional — unset means backups
  // remain unencrypted, matching Phase 31's honest default; a real
  // production deployment should set this. Must be exactly 32 bytes once
  // base64-decoded (a real AES-256 key), validated below.
  BACKUP_ENCRYPTION_KEY: z.string().optional(),

  // Phase 33 Track C: real, enforced data retention. A soft-deleted row
  // (Lead/Contact/WorkspaceMember — the specific, FK-cascade-reviewed
  // subset this phase's purge job covers; see data-retention.service.ts's
  // own doc comment for why the others aren't included yet) becomes
  // purge-eligible only after DATA_RETENTION_DAYS have passed since its
  // real `deletedAt` — a real, generous default (90 days) so "delete" in
  // the UI is never a same-day permanent-loss event.
  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  DATA_RETENTION_SCHEDULE_TIME: z.string().default('04:00'), // "HH:mm", UTC

  // Phase 33 Track F: real production alerting. Optional — a generic
  // webhook URL (Slack incoming-webhook, PagerDuty Events API, or any
  // custom receiver) that real alerts are POSTed to. Unset means alert
  // DETECTION still runs for real, but DELIVERY is honestly logged rather
  // than sent (see alerting.service.ts's `dispatchAlerts`).
  ALERT_WEBHOOK_URL: z.string().url().optional(),

  // Phase 33 Track L: real background customer-data-export artifacts —
  // local disk, same honest scope as BACKUP_DIR. A real production
  // deployment should sync/serve this from the same off-host storage
  // backups eventually use.
  EXPORT_DIR: z.string().default('./exports'),

  // AI_PLATFORM_ARCHITECTURE.md Section 2.3's AIProviderPort: MOCK is the
  // safe default so the product runs with zero paid-API dependency
  // (PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md Section 43). Set to "openai"
  // only once a real budget/key decision has been made.
  AI_PROVIDER: z.enum(['mock', 'openai']).default('mock'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  // Phase 34 Track E: a real gap found by auditing openai.adapter.ts — the
  // SDK call passed no explicit timeout, so a hung OpenAI request would
  // keep running server-side well past REQUEST_TIMEOUT_MS's 30s ceiling
  // (that middleware sends the client a 503 but cannot abort an in-flight
  // async call already past `next()` — see request-timeout.ts's own doc
  // comment). The workflow engine's step-resume logic already prevents a
  // subsequent retry from double-charging credits for a step that quietly
  // succeeds after the client gave up (it re-hydrates already-SUCCEEDED
  // steps rather than re-running them — workflow-engine.service.ts), so
  // this is a resource-hygiene fix, not a credit-safety one: bounding how
  // long an orphaned upstream call can hold a connection/resource open.
  // Kept below REQUEST_TIMEOUT_MS so the SDK's own abort fires first and
  // the adapter's real, safe UpstreamProviderError path handles it,
  // instead of the generic request-timeout handler's response racing it.
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),

  // Phase 17: opt-in only, never set by Docker/production configuration.
  // See infrastructure/database/pglite-adapter.ts's own doc comment for
  // exactly what this does and does not prove.
  USE_PGLITE_ADAPTER: booleanEnvVar(false),

  // Phase 28 Track B: mirrors AI_PROVIDER's exact pattern — MOCK is the
  // safe default (billing-provider.ts's MockBillingProvider, Phase 25),
  // never a live payment dependency unless explicitly configured. Real
  // secret values are never committed, never baked into a Docker image
  // layer or the frontend bundle — read only from the deploying
  // environment, exactly like JWT_SECRET/DATABASE_URL above.
  PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
}).superRefine((data, ctx) => {
  // Phase 21 Section 18: production must never accidentally boot with a
  // dev-only value. These are misconfiguration guards, not business-policy
  // choices — unlike AI_PROVIDER=mock (a legitimate, documented, deliberate
  // MVP operating mode; see loadEnv's separate warning below), every check
  // here fails fast because there is no scenario where a production
  // deployment should genuinely have a localhost origin or a placeholder
  // secret copied straight out of .env.example.
  if (data.NODE_ENV !== 'production') return;

  if (LOCALHOST_PATTERN.test(data.CORS_ORIGIN)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGIN'], message: 'CORS_ORIGIN must not be localhost in production.' });
  }
  if (LOCALHOST_PATTERN.test(data.DATABASE_URL)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['DATABASE_URL'], message: 'DATABASE_URL must not point at localhost in production.' });
  }
  if (DEV_PLACEHOLDER_SECRETS.has(data.JWT_SECRET)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_SECRET'], message: 'JWT_SECRET must not be a known development placeholder in production.' });
  }
  if (DEV_PLACEHOLDER_SECRETS.has(data.JWT_REFRESH_SECRET)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET must not be a known development placeholder in production.' });
  }
  if (data.JWT_SECRET === data.JWT_REFRESH_SECRET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JWT_REFRESH_SECRET'], message: 'JWT_REFRESH_SECRET must differ from JWT_SECRET in production.' });
  }
  if (data.USE_PGLITE_ADAPTER) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['USE_PGLITE_ADAPTER'], message: 'USE_PGLITE_ADAPTER must be false in production — it is in-memory and loses all data on every restart.' });
  }
}).superRefine((data, ctx) => {
  // Phase 23 Section 5: OPENAI_API_KEY is conditionally required — applies
  // in every environment (not just production), since AI_PROVIDER=openai
  // with no key is never a valid combination, and the OpenAIAdapter's own
  // constructor-time throw is a worse failure mode (deep in a request path)
  // than failing at startup.
  if (data.AI_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['OPENAI_API_KEY'], message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai.' });
  }

  // Phase 28 Track B Section 2: same fail-fast-at-startup principle as
  // OPENAI_API_KEY above — PAYMENT_PROVIDER=stripe with no real secret key
  // or webhook secret is never a valid combination, and failing here beats
  // a much deeper, less actionable failure the first time a checkout or
  // webhook request actually reaches StripeBillingProvider.
  if (data.PAYMENT_PROVIDER === 'stripe') {
    if (!data.STRIPE_SECRET_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe.' });
    } else if (!data.STRIPE_SECRET_KEY.startsWith('sk_')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'STRIPE_SECRET_KEY does not look like a real Stripe secret key (expected to start with "sk_").' });
    }
    if (!data.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_WEBHOOK_SECRET'], message: 'STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe.' });
    } else if (!data.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_WEBHOOK_SECRET'], message: 'STRIPE_WEBHOOK_SECRET does not look like a real Stripe webhook secret (expected to start with "whsec_").' });
    }
  }
  // Production must never accidentally run LIVE Stripe keys (sk_live_...)
  // in a non-production environment, and must never run in production with
  // PAYMENT_PROVIDER=stripe using a TEST key (sk_test_...) — both are real,
  // classic misconfigurations that silently move real money or silently
  // move none at all.
  if (data.PAYMENT_PROVIDER === 'stripe' && data.STRIPE_SECRET_KEY) {
    if (data.NODE_ENV === 'production' && data.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'Production must not use a Stripe TEST secret key (sk_test_...).' });
    }
    if (data.NODE_ENV !== 'production' && data.STRIPE_SECRET_KEY.startsWith('sk_live_')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STRIPE_SECRET_KEY'], message: 'Non-production environments must not use a Stripe LIVE secret key (sk_live_...).' });
    }
  }

  // Phase 32 Track B: a misconfigured encryption key (wrong length once
  // decoded) must fail fast at startup, not silently produce ciphertext
  // that can never be decrypted back — a much worse failure mode than
  // refusing to boot.
  if (data.BACKUP_ENCRYPTION_KEY) {
    let decodedLength = -1;
    try {
      decodedLength = Buffer.from(data.BACKUP_ENCRYPTION_KEY, 'base64').length;
    } catch {
      decodedLength = -1;
    }
    if (decodedLength !== 32) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['BACKUP_ENCRYPTION_KEY'], message: 'BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte (AES-256) key. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"' });
    }
  }

  // Phase 32 Track A: S3 config is all-or-nothing — a partially-configured
  // endpoint (e.g. a bucket name with no credentials) is never a valid
  // state and would otherwise fail confusingly deep inside the first real
  // upload attempt instead of at startup.
  const s3Fields: Array<[string, string | undefined]> = [
    ['S3_BUCKET', data.S3_BUCKET],
    ['S3_ACCESS_KEY_ID', data.S3_ACCESS_KEY_ID],
    ['S3_SECRET_ACCESS_KEY', data.S3_SECRET_ACCESS_KEY],
  ];
  const s3ConfiguredCount = s3Fields.filter(([, v]) => Boolean(v)).length;
  if (s3ConfiguredCount > 0 && s3ConfiguredCount < s3Fields.length) {
    for (const [field, value] of s3Fields) {
      if (!value) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required once any S3 off-site backup variable is set — S3 configuration is all-or-nothing.` });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {

    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    throw new Error('Environment validation failed — see printed field errors above.');
  }
  // AI_PROVIDER=mock is a deliberate, documented, supported production
  // operating mode for this MVP (PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md
  // Section 43) — not a misconfiguration — so it is a startup warning, not
  // a fail-fast error like the checks above.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AI_PROVIDER === 'mock') {

    console.warn('Production is running with AI_PROVIDER=mock — no real AI provider is configured. This is a supported operating mode, not an error; confirm this is intentional.');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.PAYMENT_PROVIDER === 'mock') {

    console.warn('Production is running with PAYMENT_PROVIDER=mock — no real payment provider is configured. This is a supported operating mode, not an error; confirm this is intentional.');
  }
  return parsed.data;
}

export const env = loadEnv();
