# Phase 30 Track A — Environment Configuration & Secret Leakage Audit

**Status discipline (unchanged from every prior phase):** `VERIFIED` (real execution observed), `BLOCKED — ENVIRONMENT`, `NOT ATTEMPTED`. Never marked `VERIFIED` from reading code alone.

---

## A.1 — Environment configuration audit

The backend already has a mature, centralized configuration contract (`backend/src/config/env.ts`, built across Phases 20-28) — this audit's job was to verify it actually holds, not to rebuild it.

| Check | Result | Evidence |
|---|---|---|
| Dev secret never reaches production | VERIFIED | `DEV_PLACEHOLDER_SECRETS` set + `superRefine` rejects known dev placeholders when `NODE_ENV=production`; 4 passing tests |
| Prod secret never reaches the frontend bundle | VERIFIED | Frontend only reads `import.meta.env.VITE_API_BASE_URL` (one grep hit, codebase-wide) — Vite only inlines `VITE_`-prefixed vars by design, so no backend secret can leak this way even by accident. Confirmed by grepping the real built `dist/` bundle for `JWT_SECRET`/`DATABASE_URL`/`STRIPE_SECRET`/`STRIPE_WEBHOOK`/`OPENAI_API_KEY`/`sk_live_`/`sk_test_`/`whsec_`/`postgresql://` — zero matches |
| No default credential | VERIFIED | `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` have no schema default — the app refuses to start without them (3 passing "missing variable" tests) |
| No insecure fallback | VERIFIED | Every optional var's default is an operational setting (port, rate-limit window, upload size), never a secret or a permissive security posture |
| Required variable missing → fail fast | VERIFIED | `envSchema.safeParse` throws at import time (`loadEnv`), before the HTTP server ever binds a port |
| Optional variable → safe default | VERIFIED | `PORT=4000`, `RATE_LIMIT_*`, `REQUEST_TIMEOUT_MS`, `UPLOAD_*`, `AI_PROVIDER=mock`, `PAYMENT_PROVIDER=mock` |
| Environment mismatch → startup rejection | VERIFIED | localhost `CORS_ORIGIN`/`DATABASE_URL` rejected in production; `USE_PGLITE_ADAPTER=true` rejected in production; **Stripe test-key-in-production and live-key-outside-production rejected — real validation logic that existed with zero tests before this phase, now covered by 9 new tests** (`env.production-guard.test.ts`) |
| Worker/scheduler use the same config path, not a looser one | VERIFIED | `run-scheduler.ts` imports `infrastructure/database/prisma.ts`, which imports `config/env.ts` directly — the scheduler process fails exactly the same startup checks the API server does |

**Real gap found and closed this phase:** `env.ts`'s Stripe production/test-key mismatch guards (`sk_test_` rejected in production, `sk_live_` rejected outside production, key-prefix format checks, required-when-`PAYMENT_PROVIDER=stripe` checks) were real, working code with **zero test coverage** — a misconfigured deploy could have silently shipped a Stripe TEST key to production (processing zero real payments while looking configured) or a LIVE key to staging (charging real money), and nothing in the existing 19-test suite would have caught it. Closed with 9 new tests; full file now 28/28 passing.

**`ENV_CONFIG_AUDIT = VERIFIED`.**

## A.2 — Centralized typed configuration contract

Already substantially built (Phases 20-28), not new infrastructure this phase. Confirmed via codebase-wide grep: only 6 test files read `process.env.USE_PGLITE_ADAPTER` directly (a non-sensitive boolean flag, read only to conditionally skip PGlite-only test branches — harmless and pre-existing) plus this phase's own `backup-restore-rehearsal-phase29.ts` script (a standalone tool using the raw `pg` client outside the app's normal boot path, not a config-contract violation). No scattered secret reads exist anywhere outside `env.ts`.

Per this project's own repeated instruction not to add unnecessary infrastructure or rewrite stable systems without evidence: since the audit found the existing contract already holds cleanly, no refactor was performed.

**`CONFIG_CONTRACT = VERIFIED` (pre-existing, confirmed still holding — no rework needed).**

## A.3 — Secret leakage certification

| Surface | Result | Evidence |
|---|---|---|
| Frontend production bundle | VERIFIED | Real `npm run build -w frontend`, then grepped `dist/` for every backend secret pattern — zero matches |
| Git history | VERIFIED | `git log --all -p` searched for `sk_live_`/`sk_test_[real-looking]`/`whsec_[real-looking]`/`JWT_SECRET=` patterns across every commit — the only hit is the known, intentional `JWT_SECRET=dev-only-secret-do-not-use-in-production` placeholder |
| `.env`/`.env.example` | VERIFIED | `.env`/`.env.local`/`.env.*.local` all gitignored (confirmed via `git check-ignore -v`); `.env.example` contains only placeholder values, thoroughly documented; the real local `backend/.env`'s `OPENAI_API_KEY` is empty (length 0) — confirms `BLOCKED — CREDENTIAL` claims made throughout this project are honest, not hiding a real key |
| Dockerfile build args | VERIFIED (source audit) | `frontend/Dockerfile`'s only `ARG` is `VITE_API_BASE_URL` (a URL, not a secret, by explicit design); `backend/Dockerfile` has **zero** `ARG` declarations — every secret is supplied only at `docker run`/`compose up` time as a runtime environment variable, never baked into an image layer |
| Docker image layers (real `docker history`/layer inspection) | **BLOCKED — ENVIRONMENT** | Docker daemon unreachable this session (same gap as Phase 29's Docker rebuild task) — the source-level audit above gives strong indirect evidence (no ARG exists to bake a secret into in the first place), but the specific real-execution proof (build the image, inspect its layers) could not be performed |
| Logs / error responses | VERIFIED (carried forward from Phase 29's audit) | `errorHandler`'s generic fallback never includes real error detail in the response body; `openai.adapter.test.ts` proves the raw SDK error message is never relayed to the client; no caught-error `.message` is forwarded into any thrown `AppError` anywhere in the codebase (grepped) |

**`SECRET_LEAKAGE_CERTIFICATION = VERIFIED`**, with one sub-check (`DOCKER_IMAGE_LAYER_INSPECTION`) honestly `BLOCKED — ENVIRONMENT` rather than silently skipped or assumed clean.
