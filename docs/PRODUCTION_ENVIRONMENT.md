# Production Environment Strategy

Three explicit environments. Every variable below is read exclusively through `backend/src/config/env.ts` (the sole `process.env` access point — BACKEND_ARCHITECTURE.md Section 11.1) and `frontend/vite-env.d.ts`-typed `import.meta.env`. No other file reads an environment variable directly.

## Environments

| | Development | Staging | Production |
|---|---|---|---|
| Purpose | Local machine, founder/dev use | Pre-release rehearsal, matches production topology | Real customer traffic |
| `NODE_ENV` | `development` | `production` | `production` |
| `DATABASE_URL` | Local Postgres or PGlite adapter | Dedicated staging Postgres instance | Dedicated production Postgres instance — **never shared with staging** |
| `USE_PGLITE_ADAPTER` | `true` allowed (documented fallback) | `false` — must never be true | `false` — must never be true; not read/set at all in real deployment config |
| `AI_PROVIDER` | `mock` (default, no cost) | `mock` until a real key is budgeted, then `openai` | `openai` once BLOCKED status (Section D of every phase report) is resolved |
| `OPENAI_API_KEY` | empty | staging-scoped key, low rate limit | production-scoped key, monitored (see OBSERVABILITY_RUNBOOK.md) |
| `CORS_ORIGIN` | `http://localhost:5173` | staging frontend origin only | production frontend origin only — never `*`, never multiple origins |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | dev-only placeholder (committed, labeled unsafe) | unique per-environment secret, generated, never committed | unique per-environment secret, generated, never committed, rotated per ADR-19-003 |
| `RATE_LIMIT_MAX_REQUESTS` | 1000 (generous, for iteration) | matches production | tuned from real observed traffic (Section on Performance in the Phase 19 record doc) |
| `WORKFLOW_RATE_LIMIT_MAX_EXECUTIONS` | 20/hour default | 20/hour default | reviewed against real usage before raising |
| `LOG level` | verbose (all levels) | `warn`+`error` primary, `info` retained | `warn`+`error` primary — see OBSERVABILITY_RUNBOOK.md |
| Feature flags | none implemented | none implemented | none implemented — **DEFERRED**: no feature-flag mechanism exists in the codebase yet; do not assume one when planning a release |

## Non-negotiable rules

1. **No secrets in Git.** `.gitignore` covers `.env`, `.env.local`, `.env.*.local`. `backend/.env.example` and `backend/.env.development` are intentionally tracked and contain **only** placeholder/dev-only values — verified by `git grep` for `sk-`/`AKIA` patterns every phase since Phase 16, always clean.
2. **Production must never accidentally inherit development settings.** Every variable in the table above that differs between environments has no shared default that could silently leak across — `env.ts`'s Zod schema requires `DATABASE_URL`/`JWT_SECRET`/`JWT_REFRESH_SECRET` explicitly (no default value), so a misconfigured deploy fails at startup rather than silently running with a wrong value.
3. **`USE_PGLITE_ADAPTER` must never be `true` outside development/CI.** It exists specifically so this repository could be verified without a networked Postgres server across Phases 16–19; using it in staging or production would silently discard all persisted data on every restart (PGlite is in-process, in-memory).
4. Frontend environment variables (`VITE_API_BASE_URL`) are **inlined at build time**, not read at runtime — a separate build is required per environment (see `frontend/Dockerfile`'s `ARG VITE_API_BASE_URL`), and the built bundle for one environment must never be deployed to another.

## Status of each environment (evidence-based, Phase 19)

- **Development**: VERIFIED — this is the environment every test in this repository's history has run in.
- **Staging**: DEFERRED — no staging infrastructure has ever been provisioned (Section 23 of the Phase 19 record doc).
- **Production**: DEFERRED — no production infrastructure has ever been provisioned; no real deployment has ever been attempted (Section Q of the Phase 19 record doc).
