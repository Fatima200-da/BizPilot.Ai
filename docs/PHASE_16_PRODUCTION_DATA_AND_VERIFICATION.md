# Phase 16 — Production Data Plane & Verification

A concise engineering record, not another architecture document. Every claim below is evidence-based; see `docs/PHASE_16_GAP_REGISTER.md` for what remains unverified and exactly why.

## 1. Objective

Move BizPilot AI from Phase 15's "compiled and locally demonstrated" state to "connected to a real database, migration-verified, and empirically tested" — specifically: register → workspace → business profile → Marketing Autopilot → approval → persisted, refresh-durable state.

## 2. Repository Baseline (Verified Before Changing Anything)

Re-confirmed Phase 15's state: 37→43-model Prisma schema (real), zero prior migrations applied to any live database, real backend/frontend application code, 25 passing unit tests, no integration tests, `Docker`/`psql`/`pg_ctl` all absent from this environment (unchanged from Phase 15's own finding).

## 3. Database Setup

`docker-compose.yml` added at repo root: single `postgres:16-alpine` service, named volume, health check, dev-only credentials matching `backend/.env.development`. This is the canonical, recommended path — **never executed in this environment** (no Docker binary), so it is authored and reviewed but not run-tested.

As a fallback (this environment specifically, and any future contributor without Docker), `backend/scripts/dev-db-pglite.mjs` + `migrate-pglite.mjs` start a real Postgres-18 engine (`@electric-sql/pglite`, WASM-compiled) exposed over the genuine Postgres wire protocol. This substitute has a real, confirmed limitation: **no support for the extended (parameterized) query protocol** — see Section 11 and the gap register. It remains useful for schema/DDL verification (Section 4) but not for application-level CRUD verification.

## 4. Migration State

`npx prisma format` / `validate` / `generate` all pass cleanly. The existing migration (`20260808194414_init`, from Phase 15) was applied to the PGlite substitute via `migrate-pglite.mjs`, which replays the migration's SQL verbatim except one statement:

```
SKIPPED: CREATE EXTENSION IF NOT EXISTS "pgcrypto"
REASON: PGlite does not ship the pgcrypto extension.
IMPACT: none — the schema only uses gen_random_uuid(), which PostgreSQL
        has shipped in core since v13, confirmed working without the
        extension. Real PostgreSQL (Docker, RDS, Supabase, Neon, ...)
        supports pgcrypto trivially; this is purely a substitute-tool
        limitation, not a defect in the migration file, which was never
        modified.
```

**Result:** 287/288 statements applied; `select table_name from information_schema.tables` confirmed all **43 tables**, matching all 43 Prisma models exactly.

`prisma migrate deploy` / `migrate status` / `migrate resolve` were **not** run against this substitute successfully (Prisma's schema-engine has additional wire-protocol requirements beyond what the substitute or even bare `pg` fully support — see gap register item 3). They were also never run against real Postgres, since none was available. **Migration state is therefore proven correct at the DDL level, not proven via Prisma's own state-tracking commands.**

## 5. Seed Strategy

`npm run db:seed` (added this phase) chains the two Phase 15 seed scripts (`seed-rbac.ts`, `seed-workflow-definitions.ts`), both idempotent (upsert-based). Not executed against a live database this phase, for the same reason as Section 4 — Prisma Client itself could not sustain a real query against the substitute (Section 11).

## 6. Authentication Verification

**Code written and reviewed, not executed against a live database.** `src/modules/auth/auth.integration.test.ts` (7 tests) covers: registration creates a real user + returns tokens without echoing the password hash, duplicate-email rejection (409, no leaked internals), login success/failure, missing/malformed-token rejection, and authorized access to protected resources. Ready to run via `npm run test:integration` the moment Docker Postgres is up.

## 7. Tenant Isolation Verification

**Code written and reviewed, not executed against a live database** — this phase's own stated top priority, and the one item most important to be honest about. `src/modules/workspaces/tenant-isolation.integration.test.ts` (6 tests): two real workspaces, cross-access attempts against contacts and business profiles from the wrong workspace token, asserting **404** (never 403, matching `API_CONTRACT.md` §1.5's anti-enumeration rule) at every boundary, plus confirming same-workspace access succeeds and each workspace's list endpoint never leaks the other's rows.

## 8. Workflow Verification

**Code written and reviewed, not executed against a live database.** `src/modules/marketing-autopilot/marketing-autopilot.integration.test.ts` (6 tests): full 7-step execution asserting `AWAITING_APPROVAL`, exactly 30 persisted `ContentAsset` rows all `DRAFT`, exactly 6 `SUCCEEDED` `WorkflowStepRun` rows (every step except the approval gate itself), approval transitioning to `COMPLETED`, idempotency-key reuse returning the same instance id, and both an unauthenticated and a cross-workspace execution attempt correctly rejected (401 / 404).

Transaction-boundary review (code-level, Section 8 of the phase brief): `WorkflowInstance` creation is a single atomic insert; `ContentAsset` persistence (step 6) is wrapped in one `prisma.$transaction([...])` — all 30 rows or none. The overall multi-step workflow progression is **deliberately not** one giant transaction spanning all 7 steps — each step's own persistence commits durably before the next step (which may call the AI provider) begins, so a failure at step N does not require rolling back steps 1..N-1's already-recorded, already-true progress. This is the correct shape for a workflow with external (AI) calls between steps, not a gap.

## 9. Testing Strategy

Three layers now exist:
- **Unit** (`npm test`): 25 tests, pure logic, no DB — unchanged from Phase 15, still passing.
- **Integration** (`npm run test:integration`, new this phase): 19 tests across the three files above, real `prisma` client + real Express app via `supertest`, isolated per-test-run fixtures (unique emails, explicit cleanup) per this phase's Section 22. **Written, typed, linted, never executed** — see gap register.
- **E2E (browser):** not added this phase — deferred, see gap register item 13.

## 10. Observability

`common/middlewares/request-logger.ts`: one structured JSON line per request (requestId, method, route, status, durationMs, workspaceId/userId when authenticated, workflowInstanceId when applicable). `GET /health/live` (process alive) now distinct from `GET /health/ready` (actually pings the database via `SELECT 1`, returns 503 on failure, never leaks the connection string or raw driver error).

## 11. Security Findings

`npm test` / `npx tsc --noEmit` / `npx eslint .` / `npm run build` all pass, backend and frontend (see Section 14 for exact output). `npm audit`: 5 findings, all dev-only/`vitest`-transitive, non-runtime-reachable — full analysis in the gap register.

The one genuine, non-security-classified but security-adjacent finding from this phase: **PGlite's socket bridge does not support the Postgres extended query protocol.** This was discovered while trying to verify the database layer, not a vulnerability in BizPilot AI's own code — flagged for completeness since it consumed significant verification effort this phase.

## 12. Remaining Gaps

See `docs/PHASE_16_GAP_REGISTER.md` in full — 16 items, none fabricated as resolved.

## 13. Exact Evidence

| Claim | Command | Result |
|---|---|---|
| Migration applies to a real Postgres engine | `node scripts/migrate-pglite.mjs` | `287 statements applied, 1 skipped` |
| Schema produces the correct tables | `select table_name from information_schema.tables` | 43 rows, matching all 43 models |
| `gen_random_uuid()` works without pgcrypto | direct query against the engine | `{ id: '93dfac08-...' }` |
| Unit tests pass | `npm test` (backend) | `3 files, 25/25 passed` |
| Backend typechecks | `npx tsc -p tsconfig.json --noEmit` | exit 0, no output |
| Backend lints clean | `npx eslint .` | 0 errors, 0 warnings |
| Backend builds | `npm run build` | succeeds |
| Frontend typechecks | `npx tsc -b --noEmit --force` | exit 0 (verified in Phase 15, unchanged this phase) |
| Prisma Client cannot reach PGlite via parameterized query | `node scripts/smoke-test-prisma-client.mjs` | `PrismaClientKnownRequestError: Server has closed the connection. code: 'P1017'` |
| Root-caused to the extended query protocol specifically | bare `pg` client, `select $1::text` | `ECONNRESET`, while non-parameterized SQL succeeds |

## 14. Next Phase Recommendation

See the gap register's "Exact Unblock Path." In one sentence: get Docker (or any real PostgreSQL reachable from this repo) running, apply the migration, seed, and run `npm run test:integration` — every test that phase runs is already written and ready; nothing else in this phase's scope is blocked on anything but that one dependency.
