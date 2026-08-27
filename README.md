# BizPilot AI

A production-grade AI SaaS platform. This repository is a monorepo containing the frontend application, backend API, and supporting documentation/assets.

> **Status:** Release candidate `0.1.0-rc.18` — **RELEASE CANDIDATE — MINOR BLOCKERS**. Phase 34 shifted focus from backend engineering to real customer experience: found and fixed a genuine onboarding dead-end (a user who left mid-flow had no way back), a stale-cache bug masking a just-created business profile, a production-topology gap that would have collapsed rate limiting behind the real reverse proxy, a missing AI-provider timeout, and an `X-Powered-By` information leak — each found via real execution (live browser testing, real attacks against the running app, real `curl`), not code review. Built a complete SEO surface (previously entirely absent), a real "needs attention" dashboard alert, and 5 more operations runbooks plus a single master launch checklist. Ran 16 real, scripted attacks against the live application (15 correctly blocked, 1 blocked by a real plan-limit instead — zero confirmed vulnerabilities) and real p50/p95/p99 performance measurements with `EXPLAIN ANALYZE` query-plan verification (no unjustified index added). **106/106 backend unit, 384/385 backend integration tests on real PostgreSQL** (the 1 failure is the same pre-existing timing flake documented since Phase 30, independently re-confirmed clean 7/7 in isolation this phase), **13/13 Playwright E2E**, 0 lint/typecheck errors (backend + frontend), clean secret scans. Docker rebuilt and re-verified with all fixes applied. See [docs/PHASE_34_PRODUCTION_LAUNCH_GROWTH_CERTIFICATION.md](docs/PHASE_34_PRODUCTION_LAUNCH_GROWTH_CERTIFICATION.md), [docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md](docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md), the [docs/ops/](docs/ops/) runbooks, and [CHANGELOG.md](CHANGELOG.md) for full detail. **This is not a `PRODUCTION READY` claim** — the remaining gates are real credentials (Stripe, OpenAI, off-host backup storage, alert-webhook delivery) plus two honestly-scoped minor UX gaps (UI language consistency, one unconfirmed mobile animation), none of which require further engineering to close once decided — see those documents before deploying.

## Tech Stack

**Frontend** — React 19 · TypeScript · Vite · Tailwind CSS v4 · React Router · TanStack Query · React Hook Form · Zod · Axios · Framer Motion · Lucide Icons

**Backend** — Node.js · Express · Prisma · PostgreSQL · JWT Authentication · bcrypt · Helmet · CORS · express-rate-limit · Multer · OpenAI SDK

## Repository Structure

```
bizpilot-ai/
├── frontend/     React SPA (feature-based architecture)
├── backend/      Express API (modular, layered architecture)
├── docs/         Architecture and API documentation
├── database/     Seed data and migration reference material
├── assets/       Brand and marketing assets
└── prompts/      Versioned AI prompt templates
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full architectural breakdown of each application.

## Prerequisites

- Node.js `>= 20.11.0`
- npm `>= 10.0.0`
- Docker (recommended, for real PostgreSQL via `docker-compose.yml`) — **or** see the no-Docker fallback below

## Getting Started

1. **Clone and install dependencies** (installs both workspaces from the repo root):

   ```bash
   git clone <repository-url> bizpilot-ai
   cd bizpilot-ai
   npm install
   ```

2. **Configure environment variables:**

   ```bash
   cp frontend/.env.example frontend/.env
   cp backend/.env.example backend/.env
   ```

3. **Start PostgreSQL, migrate, and seed:**

   ```bash
   docker compose up -d
   cd backend
   npm run prisma:migrate:deploy
   npm run db:seed
   cd ..
   ```

   **No Docker available?** Use the PGlite fallback instead (real Postgres engine, no install required — see `backend/scripts/dev-db-pglite.mjs` for its one documented limitation):

   ```bash
   cd backend
   npm run db:dev:pglite        # in one terminal, leave running
   npm run db:migrate:pglite    # in another terminal
   npm run db:seed              # DATABASE_URL must point at the pglite instance
   ```

4. **Run both apps in development mode** (frontend on `:5173`, backend on `:4000`):

   ```bash
   npm run dev
   ```

   Or run them individually:

   ```bash
   npm run dev:frontend
   npm run dev:backend
   ```

5. **Run tests:**

   ```bash
   npm test -w backend                  # unit — no database required
   npm run test:integration -w backend  # integration — requires steps 3-4
   npx playwright test                  # browser E2E — starts its own PGlite-backed backend + frontend (see playwright.config.ts)
   ```

## Common Scripts (from repo root)

| Command | Description |
| --- | --- |
| `npm run dev` | Run frontend and backend concurrently |
| `npm run build` | Build both workspaces for production |
| `npm run lint` | Lint both workspaces |
| `npm run format` | Format the entire repo with Prettier |
| `npm run format:check` | Check formatting without writing changes |

Each workspace also exposes its own scripts — run with `-w frontend` or `-w backend`, e.g. `npm run typecheck -w frontend`.

**Production Docker images** (`backend/Dockerfile`, `frontend/Dockerfile`) exist and are structurally reviewed (multi-stage, non-root, minimal runtime) but have never actually been built or run — Docker is unavailable in the environment they were authored in. Do not treat `docker build` as verified until it has actually been run once; see `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Product Requirements (PRD)](docs/PRD.md)
- [Database Design](docs/DATABASE.md) — ERD, Prisma schema, architecture rationale (`backend/prisma/schema.prisma`)
- [Authentication & Authorization Architecture](docs/AUTH_ARCHITECTURE.md)
- [API Contract & Design Specification](docs/API_CONTRACT.md) — REST conventions, error spec, security, full resource catalog
- [Backend Core Architecture](docs/BACKEND_ARCHITECTURE.md) — layering, module system, DDD patterns, engines, async processing, folder structure
- [AI Platform Architecture](docs/AI_PLATFORM_ARCHITECTURE.md) — LLM orchestration, memory, RAG, multi-modal, agents/tools, workflow automation, AI safety & economics
- [Cloud Infrastructure & Site Reliability Architecture](docs/CLOUD_INFRASTRUCTURE.md) — cloud topology, networking/CDN/edge, Kubernetes, CI/CD & GitOps, IaC, secrets, database DR/backup, observability, autoscaling & cost, security operations, production readiness
- [Frontend Platform Architecture](docs/FRONTEND_ARCHITECTURE.md) — component system, state management, routing & multi-tenancy, streaming/real-time, AI-native UI (Copilot, Workflow Builder, AI Employee Workspace), performance, accessibility, i18n, plugin/white-label extensibility
- [Enterprise Intelligence Platform Architecture](docs/ENTERPRISE_INTELLIGENCE_ARCHITECTURE.md) — Digital Twin, Knowledge Graph, AI Workforce (AI Executive Team, Decision Council, multi-agent collaboration), Business/Domain Intelligence, Forecasting & Simulation, Decision Engine & Autonomous Decision Levels, Executive Command Center, multi-company/holding-company architecture, AI governance & safety
- [Engineering Operating System & Development Standards](docs/ENGINEERING_STANDARDS.md) — architecture governance, repo/ownership, coding/testing/CI-CD standards, release & production gates, incident management, security engineering, AI engineering governance, performance/scalability/cost engineering, team topology, 5-level engineering maturity model, the BizPilot Engineering Constitution
- [Trust, Security & Compliance Architecture](docs/TRUST_SECURITY_COMPLIANCE_ARCHITECTURE.md) — Zero Trust control/data plane, unified authorization fabric, tenant isolation assurance, AI trust boundary & authority matrix, prompt injection defense, agent/tool/RAG/memory security, data classification & lifecycle, secrets & key architecture, privileged access management & break-glass, security event fabric & detection, incident response, supply chain & secure SDLC, AI red team, privacy architecture, compliance control plane, security posture engine, threat modeling, risk register, 5-level security maturity model
- [Commercial Intelligence, Monetization & Growth Architecture](docs/COMMERCIAL_INTELLIGENCE_ARCHITECTURE.md) — value taxonomy & realization engine, commercial metering, unit economics, AI cost economics & margin protection, credit economy, pricing/packaging, AI Employee & workflow economics, product-led growth, expansion/retention, enterprise & marketplace & developer-platform economics, customer profitability, pricing experimentation, financial simulation, anti-commoditization analysis, economic safety model, 6-level commercial maturity model
- [Global Platform & Ecosystem Architecture](docs/GLOBAL_PLATFORM_ECOSYSTEM_ARCHITECTURE.md) — three-plane ecosystem reference architecture, Developer Platform & API Products, generic Connector Contract, Event Platform & envelope, Plugin/Extension Platform, AI Skill & AI Employee ecosystems, Workflow Ecosystem, Marketplace architecture & trust/safety, Partner Platform, White-Label/OEM distribution, ecosystem commerce & observability, global scale classification, platform governance, ecosystem security, data & API contract extensions, 5-level platform maturity model
- [Product Execution & MVP Architecture](docs/PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md) — product thesis & vision, Azerbaijan-first go-to-market strategy, target ICP, three killer workflows (Marketing Autopilot, Business Analyzer, CRM & Sales Assistant), Workflow Engine schema, Human-in-the-Loop autonomy mapping, MVP/V1/V2/Scale/Global scope, monetization & pricing, competitive positioning & moat, technical implementation blueprint, database/API/backend/frontend impact analysis, AI provider abstraction & no-paid-API development strategy, integration priority matrix, launch/production readiness, risk register, ADRs, founder execution plan
- [Phase 16 — Production Data & Verification](docs/PHASE_16_PRODUCTION_DATA_AND_VERIFICATION.md) — real-database setup, migration state, seed strategy, authentication/tenant-isolation/workflow verification approach, testing strategy (unit/integration), observability, exact evidence for every claim
- [Phase 17 — Production Validation & MVP Release](docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md) — real PGlite-native-engine verification (19/19 integration tests), the production routing bug found and fixed, tenant-isolation/auth/workflow evidence, 16-gate MVP release gate (verdict: **NOT YET RELEASE-READY**), performance baseline, and honest FACT/VERIFIED/INFERRED/BLOCKED labeling throughout
- [Phase 18 — Production Launch Validation](docs/PHASE_18_PRODUCTION_LAUNCH_VALIDATION.md) — the first browser-level (Playwright) E2E suite for this product, which found and fixed 5 real bugs (3 severe enough to block the core loop for every user); RBAC negative-path gap closed; tenant isolation extended to 13 tests across every verb/resource; failure-resilience and concurrency testing (found and fixed a real idempotency-race 500 and a fully dead retry-on-failure code path); a real PostgreSQL 18 server found in this environment (credentials never obtained); 23-gate release matrix
- [Phase 19 — Production Operations & Release](docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md) — production hardening (request timeouts, compression, crash handlers), a new `/metrics` observability endpoint, a workflow-execution cost guardrail, structural Docker images + CI/CD pipeline (not yet runtime-verified — Docker unavailable in this environment), full operational runbooks, 6 ADRs, the "resume my existing plan" fix, 44/44 integration + 9/9 E2E tests, a 28-gate release matrix (verdict: **RELEASE CANDIDATE — BLOCKED**)
- [Phase 20 — Production Certification & Reliability Hardening](docs/PHASE_20_PRODUCTION_CERTIFICATION.md) — the two mandatory reliability fixes (ContentAsset idempotency with the correct domain identity, atomic concurrent-approval state transition), a full workflow state-machine transition audit (found declared-but-unreachable transitions, reported honestly), an expanded `.env.example`, extended performance certification (p50/p95/p99, 2 new measured operations), 49/49 integration tests (up from 44), a 23-gate release matrix (verdict: **RELEASE CANDIDATE — BLOCKED**)
- [Phase 21 — Production Certification & Release Engineering](docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md) — full re-certification via live HTTP probing against a running server, which found and fixed 2 real HIGH-severity bugs (`USE_PGLITE_ADAPTER=false` silently coerced to `true`; zero production-config misconfiguration guards) plus a tooling defect that had invalidated the two heaviest performance measurements since they were introduced; live-demonstrated the cost guardrail under genuine credit exhaustion; expanded the disaster-recovery runbook with 9 full incident playbooks; 37/37 unit tests (up from 25), a 20-gate release matrix (verdict: **RELEASE CANDIDATE — BLOCKED**) — see also [Phase 21 Security Certification](docs/PHASE_21_SECURITY_CERTIFICATION.md) and [First-Customer Production Checklist](docs/FIRST_CUSTOMER_PRODUCTION_CHECKLIST.md)
- [Phase 22 — Real PostgreSQL Production Certification](docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md) — **the phase that closed `REAL_POSTGRES = BLOCKED`**: real credentialed connection to a networked PostgreSQL 18 server, real migrations, real idempotent seeds, 41/41 unit + 49/49 integration + 9/9 E2E all passing against the real server, live transaction/concurrency/credit-ledger/rollback proofs (including a database-level unique-constraint rejection via raw SQL), a real `pg_dump` backup restored and verified row-for-row across all 44 tables, and real-vs-PGlite performance figures clearly distinguished; a 26-gate release matrix (verdict: **RELEASE CANDIDATE — MINOR BLOCKERS**, upgraded from BLOCKED)
- [Phase 23 — Production Containerization & Deployment Certification](docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md) — **the phase that actually ran BizPilot.Ai inside real Docker containers.** Once Docker became reachable, real `docker build` runs immediately surfaced 4 genuine build/runtime defects (a non-existent COPY path, wrong build-step ordering, a missing shared tsconfig that silently dropped strict type-checking, and a production container that crashed on every startup) that structural review had missed; running the actual containers surfaced 2 more (duplicated security headers, a build-environment path-mangling bug that silently broke every API call). All 6 found and fixed, then re-verified through full real-container certification: real first database query, the complete golden path and concurrent-approval safety, real cross-tenant isolation, **9/9 Playwright E2E against the actual production containers** (a first — not dev servers), a real restart/persistence cycle, real failure injection, a real stability soak test, and a full rollback rehearsal; 20/20 evidence-table gates VERIFIED via real execution, seventh release candidate (`0.1.0-rc.7`), verdict unchanged at **RELEASE CANDIDATE — MINOR BLOCKERS** (only a real AI provider credential remains, a business decision not an engineering blocker)
- [Production Environment Strategy](docs/PRODUCTION_ENVIRONMENT.md) · [Observability Runbook](docs/OBSERVABILITY_RUNBOOK.md) · [Security Release Checklist](docs/SECURITY_RELEASE_CHECKLIST.md) · [Disaster Recovery Runbook](docs/DISASTER_RECOVERY_RUNBOOK.md) · [Production Release Runbook](docs/PRODUCTION_RELEASE_RUNBOOK.md)
- [First-Customer Readiness](docs/FIRST_CUSTOMER_READINESS.md) — a real, directly-observed walkthrough as an Azerbaijani small-business-owner persona, with a prioritized friction-point table
- [Changelog](CHANGELOG.md) — every real fix and addition, with root causes
- [Phase 16 — Gap Register](docs/PHASE_16_GAP_REGISTER.md) — every gap's original status plus its Phase 17 resolution, nothing dropped silently, including the exact PostgreSQL-availability blocker and unblock commands (superseded as the current source of truth by Phase 19's release gate, above, for anything re-verified since)
- [Design System](docs/design-system/README.md) — tokens, components, conventions (`frontend/src/shared/components/`)
- [API Reference](docs/API.md) *(placeholder — populated once backend routes exist)*

## Roadmap

This scaffold intentionally stops before application logic. Next phases:

1. ~~Database schema~~ (see [docs/DATABASE.md](docs/DATABASE.md)) and initial migration.
2. Backend: ~~authentication design~~ ([docs/AUTH_ARCHITECTURE.md](docs/AUTH_ARCHITECTURE.md)) + ~~API contract~~ ([docs/API_CONTRACT.md](docs/API_CONTRACT.md)) + ~~core architecture~~ ([docs/BACKEND_ARCHITECTURE.md](docs/BACKEND_ARCHITECTURE.md)) + ~~AI platform architecture~~ ([docs/AI_PLATFORM_ARCHITECTURE.md](docs/AI_PLATFORM_ARCHITECTURE.md)) → implementation.
3. ~~Frontend design system~~ (see [docs/design-system](docs/design-system/README.md)) + application shell (routing, providers).
4. ~~Cloud infrastructure & DevOps architecture~~ ([docs/CLOUD_INFRASTRUCTURE.md](docs/CLOUD_INFRASTRUCTURE.md)).
5. ~~Frontend platform architecture~~ ([docs/FRONTEND_ARCHITECTURE.md](docs/FRONTEND_ARCHITECTURE.md)).
6. ~~Enterprise Intelligence platform architecture~~ ([docs/ENTERPRISE_INTELLIGENCE_ARCHITECTURE.md](docs/ENTERPRISE_INTELLIGENCE_ARCHITECTURE.md)).
7. ~~Phase 11 — Engineering operating system & development standards~~ ([docs/ENGINEERING_STANDARDS.md](docs/ENGINEERING_STANDARDS.md)).
8. ~~Phase 12 — Trust, security & compliance architecture~~ ([docs/TRUST_SECURITY_COMPLIANCE_ARCHITECTURE.md](docs/TRUST_SECURITY_COMPLIANCE_ARCHITECTURE.md)).
9. ~~Phase 13 — Commercial intelligence, monetization & growth architecture~~ ([docs/COMMERCIAL_INTELLIGENCE_ARCHITECTURE.md](docs/COMMERCIAL_INTELLIGENCE_ARCHITECTURE.md)).
10. ~~Phase 14 — Global platform & ecosystem architecture~~ ([docs/GLOBAL_PLATFORM_ECOSYSTEM_ARCHITECTURE.md](docs/GLOBAL_PLATFORM_ECOSYSTEM_ARCHITECTURE.md)).
11. ~~Phase 15 — Product execution & MVP strategy~~ ([docs/PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md](docs/PRODUCT_EXECUTION_AND_MVP_ARCHITECTURE.md)).
12. ~~MVP implementation~~ — backend bootstrap, AI Provider Abstraction + mock adapter, Workflow Engine, Marketing Autopilot & Business Analyzer workflows, CRM, frontend app (auth/onboarding/dashboard/workflow review), 25 passing unit tests.
13. ~~Phase 16 — Production data plane & verification~~ ([docs/PHASE_16_PRODUCTION_DATA_AND_VERIFICATION.md](docs/PHASE_16_PRODUCTION_DATA_AND_VERIFICATION.md)) — `docker-compose.yml`, real-Postgres driver adapter, structured logging, real health checks, and a full integration test suite, all written and ready.
14. ~~Phase 17 — Production validation & MVP release~~ ([docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md](docs/PHASE_17_PRODUCTION_VALIDATION_AND_MVP_RELEASE.md)) — real verification against a real Postgres engine via a hand-written PGlite-native driver adapter (`backend/src/infrastructure/database/pglite-adapter.ts`): 19/19 integration tests, a real production routing bug found and fixed, tenant-isolation/auth/workflow evidence, a 16-gate MVP release check.
15. ~~Phase 18 — Production launch validation~~ ([docs/PHASE_18_PRODUCTION_LAUNCH_VALIDATION.md](docs/PHASE_18_PRODUCTION_LAUNCH_VALIDATION.md)) — the first browser-level (Playwright) E2E suite for this product (`e2e/golden-path.spec.ts`), which found and fixed 5 real bugs including 3 that blocked the core product loop for every user; RBAC negative-path gap closed; tenant isolation extended to 13 tests; 40/40 integration tests (up from 19); first release candidate cut (`0.1.0-rc.1`).
16. ~~Phase 19 — Production operations, deployment & reliability~~ ([docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md](docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md)) — production hardening (request timeouts, compression, crash handlers, 2 more real bugs found and fixed), `/metrics` observability, a workflow-execution cost guardrail, structural Docker + CI/CD (`.github/workflows/ci.yml`, not yet runtime-verified), 5 new operational runbooks, 6 ADRs, the "resume my existing plan" fix (closing Phase 18's top first-customer gap), 44/44 integration + 9/9 E2E tests, second release candidate cut (`0.1.0-rc.2`, see [CHANGELOG.md](CHANGELOG.md)). **Overall verdict: RELEASE CANDIDATE — BLOCKED** — see [docs/FIRST_CUSTOMER_READINESS.md](docs/FIRST_CUSTOMER_READINESS.md) for what's left from a real customer's point of view.
17. ~~Phase 20 — Production certification & reliability hardening~~ ([docs/PHASE_20_PRODUCTION_CERTIFICATION.md](docs/PHASE_20_PRODUCTION_CERTIFICATION.md)) — the two mandatory fixes Phase 19 left open: ContentAsset idempotency (determined the real domain identity from the schema — `(workflowInstanceId, day, platform, contentType)`, not the naive `(workflowInstanceId, day)` — then enforced it with a DB constraint + upsert) and a concurrent-approval race (fixed with an atomic conditional `updateMany` state transition, proven with a genuinely concurrent `Promise.all` test), plus a full workflow state-machine transition audit, an expanded `.env.example`, and extended p50/p95/p99 performance certification. 49/49 integration tests (up from 44), third release candidate cut (`0.1.0-rc.3`, see [CHANGELOG.md](CHANGELOG.md)). **Overall verdict: RELEASE CANDIDATE — BLOCKED** — still the same single root cause.
18. ~~Phase 21 — Production certification & release engineering~~ ([docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md](docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md)) — re-certified the whole system via live HTTP probing against a running server rather than re-citing prior reports, which found and fixed 2 real HIGH-severity bugs three prior phases of code review had missed (`USE_PGLITE_ADAPTER=false` silently coerced to `true` by a `z.coerce.boolean()` defect; zero production-config misconfiguration guards existed), plus a tooling defect that had invalidated the two heaviest performance measurements ("workflow create+complete", "approval") in every prior phase's report since they were introduced. Also: live-demonstrated the AI-credit cost guardrail under genuine exhaustion, expanded the disaster-recovery runbook with 9 full incident playbooks, and produced a real first-customer production checklist. 37/37 unit tests (up from 25), fourth release candidate cut (`0.1.0-rc.4`, see [CHANGELOG.md](CHANGELOG.md)). **Overall verdict: RELEASE CANDIDATE — BLOCKED** — still the same single root cause.
19. ~~Phase 22 — Real PostgreSQL production certification~~ ([docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md](docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md)) — **the phase that closed the single root-cause blocker every prior phase since Phase 18 reported.** The user provisioned a least-privilege `bizpilot_app` role and `bizpilot_ai_dev` database on the local PostgreSQL 18 server; from there, real migrations deployed cleanly, real seeds ran idempotently, and the full test suite ran against the real server for the first time ever: 41/41 unit, 49/49 integration, 9/9 Playwright E2E. Live-proved transaction/concurrency/idempotency/credit-ledger/rollback behavior against real Postgres, including a raw SQL duplicate insert rejected directly by the database's own unique constraint. Executed a real `pg_dump` backup and a real restore, verified row-for-row across all 44 tables. Measured real-Postgres performance and clearly distinguished it from PGlite figures. Fifth release candidate cut (`0.1.0-rc.5`, see [CHANGELOG.md](CHANGELOG.md)). **Overall verdict: RELEASE CANDIDATE — MINOR BLOCKERS** (upgraded from BLOCKED) — only Docker (unavailable in this environment) and a real AI provider credential remain, both environment/credential gaps rather than discovered defects.
20. ~~Phase 23 — Production containerization & deployment certification~~ ([docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md](docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md)) — **the phase that actually ran BizPilot.Ai inside real Docker containers.** Docker became reachable mid-phase; real `docker build` runs immediately surfaced 4 genuine defects structural review had missed (a non-existent `COPY` path from npm workspace hoisting; `tsc` running before `prisma generate`; both Dockerfiles missing a shared `tsconfig.base.json`, silently dropping strict type-checking; and a production container that crashed on every startup because `prisma.ts` statically imported a devDependency-only module). Running the actual containers surfaced 2 more (Nginx duplicating the backend's own security headers on proxied API responses; a Git-Bash MSYS path-mangling bug that silently corrupted the frontend's baked-in API URL, breaking every API call with zero visible network activity). All 6 found and fixed, then re-verified end-to-end: real first database query from inside a container (via `host.docker.internal` to the existing real Postgres, explicitly not a fresh compose-bundled one), the complete golden path and concurrent-approval race safety, real cross-tenant isolation, **9/9 Playwright E2E against the actual production containers** (the first time ever against real containers rather than dev servers), a real restart/persistence cycle, real failure injection, a real 400-request stability soak test, and a full rollback rehearsal (bad-candidate deploy → detected via `/health/ready` → rolled back → verified recovered). 20/20 evidence-table gates VERIFIED via real execution. 48/48 unit tests, seventh release candidate cut (`0.1.0-rc.7`, see [CHANGELOG.md](CHANGELOG.md)). **Overall verdict: RELEASE CANDIDATE — MINOR BLOCKERS** (unchanged category — every engineering gate is now closed; only a real AI provider credential remains, a business decision not an engineering blocker).
21. **Next: obtain a real `OPENAI_API_KEY` and run the AI-provider certification deferred since Phase 20** — real provider routing, timeout handling, malformed-output handling, retry, metering, and credit enforcement against the actual OpenAI API. That is the one remaining step between `RELEASE CANDIDATE — MINOR BLOCKERS` and a genuine `PRODUCTION READY` verdict. After that: the remaining prioritized friction points in `docs/FIRST_CUSTOMER_READINESS.md`.
