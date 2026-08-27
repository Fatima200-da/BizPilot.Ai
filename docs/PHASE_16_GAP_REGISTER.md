# Phase 16 — Production-Readiness Gap Register

**Updated in Phase 17.** Every item below carries its Phase 16 status plus a Phase 17 resolution — nothing disappears silently, per that phase's own explicit instruction. New items discovered in Phase 17 are appended at the end.

**Phase 18/19 note**: item 1 (no real Postgres) remains the single root cause of every BLOCKED gate through Phase 19 — a real PostgreSQL 18 server was found running in this environment as of Phase 18, but working credentials for it have not been obtained through Phase 19 either. The current, authoritative source of truth for release status is `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`'s 28-gate release matrix (Section AA), which supersedes this document's table for anything re-verified in Phase 18 or 19 — this document is kept for its historical Phase 16→17 resolution record, not re-transcribed here a third time.

| # | Gap | Severity | Owner | Trigger | Phase 16 Status | **Phase 17 Status** |
|---|---|---|---|---|---|---|
| 1 | No real Docker/PostgreSQL server reachable in this environment. | Critical | Whoever runs this repo next, with Docker | Immediately | Open | **Still BLOCKED** — Docker/`psql`/`pg_ctl` re-verified absent at the start of Phase 17 too. See item 18 below for what Phase 17 built as a genuine (if scoped) workaround. |
| 2 | `@electric-sql/pglite-socket`'s wire-protocol bridge doesn't support the Postgres extended (parameterized) query protocol. | High | pglite-socket maintainers / use real Postgres | N/A against real Postgres | Open | **CLOSED (root-caused, worked around).** Confirmed the bug is specific to the *socket* bridge, not PGlite itself — PGlite's **native** in-process query interface handles parameters correctly (verified directly). Phase 17 built `infrastructure/database/pglite-adapter.ts` against the native interface instead, sidestepping the bug entirely. |
| 3 | `prisma migrate status`/`resolve` fail against the PGlite socket substitute. | Medium | Same | N/A against real Postgres | Open | **DEFERRED, superseded.** The native adapter path (item 18) doesn't attempt to use Prisma's migrate-engine CLI commands at all — it replays migration SQL directly. This specific gap (Prisma CLI vs. PGlite) is no longer on the critical path; still genuinely unresolved against real Postgres because none was available to test against. |
| 4 | Registration/login/tenant-isolation/CRM/workflow persistence/approval/idempotency — written but never empirically executed. | Critical | Next session, with Docker | `docker compose up -d && ...` | Open | **VERIFIED.** All of it now executed — **19/19 integration tests pass** against a real Postgres engine via the native PGlite adapter, through the real HTTP stack (Express, JWT, bcrypt, Zod, RBAC). See `docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md` Sections 5-16 for full evidence. Caveat: this is a real Postgres *engine*, not a real Postgres *server* — see that document's honesty framing before treating this as equivalent to a Docker-based run. |
| 5 | Migration DDL verified against a real Postgres 18 engine (43 tables). | — | — | — | Closed | **Still CLOSED**, now reinforced: the same migration was successfully replayed and then exercised with real CRUD 19 additional times this phase. |
| 6 | `prisma migrate deploy`/`status` never run against real Postgres. | Medium | Next session | Docker available | Open | **Still OPEN/BLOCKED** — genuinely requires real PostgreSQL, which remains unavailable. Confidence is now higher (the schema has now processed real inserts/updates/deletes/transactions/cascades successfully via a real engine), but the literal claim "Prisma CLI's migrate command was run against Postgres" remains unverified. |
| 7 | Payment provider integration. | — | Commercial/Finance | Real billing | Deferred | **Still DEFERRED** — unchanged, V1 horizon. |
| 8 | Meta (WhatsApp/Instagram) verification. | — | Founder/Partnerships | V1 | Deferred | **Still DEFERRED** — process not started. |
| 9 | Object storage for uploads. | — | Engineering | V1 expansion | Deferred | **Still DEFERRED** — unchanged. |
| 10 | Production AI provider (real `OPENAI_API_KEY`). | — | Founder | Real launch | Deferred | **Still DEFERRED** — no key available or required this phase either. `OpenAIAdapter` still compiles, still untested against a live key. |
| 11 | Cookie-based auth. | Low | Engineering | SSR need | Deferred | **Still DEFERRED** — Bearer-only remains sufficient. |
| 12 | Generic `Idempotency-Key` middleware. | Low | Engineering | Broader need | Deferred | **Still DEFERRED** — unchanged. |
| 13 | E2E browser-level test. | Medium | Engineering | Docker available | Deferred | **Still DEFERRED (browser specifically)**, but **substantially strengthened**: a full golden-path HTTP-level E2E now runs and passes for real (register → login → workspace → business profile → Marketing Autopilot → 30 ContentAssets → approve), which is everything a browser E2E would prove except the actual rendering/DOM layer. A true Playwright suite remains unwritten. |
| 14 | 5 `npm audit` findings (dev-only, `vitest`-transitive `esbuild`). | Low | Engineering | — | Reviewed, not fixed | **Unchanged** — same analysis holds; no new dependencies changed this conclusion. |
| 15 | No Redis/queue-backed workflow execution. | — | Engineering | Real concurrent load | Deferred | **Still DEFERRED** — still correct at current scale; this phase's own workflow-engine reliability work (retry, idempotency) was verified working in-process, reinforcing that a queue isn't yet needed. |
| 16 | `@prisma/adapter-pg` (the real-Postgres driver adapter) never run against real Postgres. | Medium | Next session | Docker available | Open | **Still OPEN** — Phase 17 verified a *different* adapter (the hand-written PGlite-native one, item 18) extensively; `@prisma/adapter-pg` itself, which is what production/Docker configuration actually uses, remains untested against a live server. It is Prisma's own standard, officially-supported mechanism, so risk is assessed as low, but "assessed as low risk" is not the same claim as "verified." |

## New Findings — Phase 17

| # | Finding | Severity | Status |
|---|---|---|---|
| 17 | **Real production bug found and fixed:** `workflow.routes.ts` defined `GET /instances/:id`, but `app.ts` already mounts that router at `/workflow-instances` — producing an unreachable `/workflow-instances/instances/:id` path that never matched what the frontend actually calls (`/workflow-instances/:id`). Every "review your generated content calendar" request would have 404'd in production. Never caught because this route had never been exercised via a real HTTP request until Phase 17's integration suite finally ran. | **Critical (would have blocked the core product loop)** | **CLOSED** — route fixed to `/:id`, `/:id/approve`, `/:id/reject`; the specific integration test that caught it now passes and stays in the suite as a regression guard. |
| 18 | **New asset delivered:** `backend/src/infrastructure/database/pglite-adapter.ts` — a hand-written, minimal Prisma driver adapter for PGlite's native (non-socket) query interface. Explicitly scoped and documented as NOT a general-purpose, independently-validated Postgres bridge — it maps only the Postgres types this schema uses and is verified against this repository's own test suite, not an external correctness reference. Opt-in only via `USE_PGLITE_ADAPTER=true`; production/Docker configuration never sets this. | Informational | **CLOSED / delivered**, scope explicitly bounded in the code's own doc comment and in Section 4 of the Phase 17 record doc. |
| 19 | Performance baseline captured from real request timings (structured logs, `durationMs`) during the integration suite run. | Informational | **VERIFIED, with an explicit environment caveat** — see Phase 17 record doc Section 18. This is real, measured latency, but measured against the PGlite-native engine (in-process, WASM), not a networked Postgres server — CPU-bound costs (bcrypt) transfer directly; network-round-trip costs do not necessarily. |

## `npm audit` Analysis (Item 14, unchanged from Phase 16)

```
5 vulnerabilities (3 moderate, 1 high, 1 critical)
```
Package: `esbuild` (via `vite` → `vite-node` → `vitest`'s transitive chain). Dev-only, never shipped in `npm run build`'s output. Not fixed — the suggested fix forces a breaking `vitest` major-version bump for a non-runtime-reachable advisory.

## Exact Unblock Path (unchanged — still the correct, canonical path)

```bash
docker compose up -d
docker compose ps
cd backend
npm run prisma:migrate:deploy
npm run prisma:migrate:status
npm run db:seed
npm run test:integration
```

## How to Reproduce This Phase's PGlite-Based Verification (the actual workaround used)

```bash
cd backend
export USE_PGLITE_ADAPTER=true
export DATABASE_URL="postgresql://unused:unused@localhost:5432/unused"  # ignored by the adapter, still required by config/env.ts's schema
npx tsx src/scripts/verify-pglite-golden-path.ts     # direct Prisma Client verification
npx tsx src/scripts/verify-health-ready.ts           # /health/ready real-DB-ping verification
npx vitest run --config vitest.integration.config.ts # full 19-test HTTP-level integration suite
```
