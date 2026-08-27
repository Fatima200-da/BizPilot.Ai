# Deployment Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** real build, migrate, and deploy steps. See [`ROLLBACK_RUNBOOK.md`](ROLLBACK_RUNBOOK.md) if a deployment needs to be undone.

## Environment note

**No containerized/Docker deployment path has been exercised in this development environment** — `docker info` fails here (`BLOCKED — ENVIRONMENT`, confirmed fresh at every phase this session, most recently Phase 33). This runbook describes the real build/run steps that any deployment target (containerized or not) must perform; it does not certify a specific hosting platform's pipeline.

## Pre-deployment checklist

1. **Full regression must be green** before a real deploy: backend unit + integration tests, frontend build, both lint and typecheck suites (backend `npm run lint`/`npm run typecheck`, frontend equivalents), and Playwright E2E if the change touches user-facing flows.
2. **Migrations must be reviewed** — any new `backend/prisma/migrations/*/migration.sql` should be read in full before deploy, not just trusted because `prisma migrate dev` generated it. Confirm it's additive/backward-compatible where possible (see the Rollback runbook's migration-compatibility section) — the running application version immediately before a deploy must still function against the POST-migration schema for the brief window where old app code and new schema coexist during a rolling deploy.
3. **Version sync**: confirm `VERSION`, `backend/package.json`, `frontend/package.json`, and root `package.json` all carry the same version string, and `CHANGELOG.md` has a real entry for it — a version mismatch across these files is itself a real defect to fix before deploying, not a cosmetic issue.
4. **Secrets present**: confirm every secret required by `backend/src/config/env.ts`'s startup validation is set in the target environment — the app will refuse to boot on a missing/malformed required secret, which is the correct, intended failure mode (fail fast at startup, not silently at request time).

## Build

```bash
npm run build
```
Runs `build:frontend` (Vite production build → `frontend/dist/`) then `build:backend` (`tsc -p tsconfig.json` → `backend/dist/`) from the repo root. Confirm both complete with zero errors — a build warning is not automatically safe to ignore; read it.

## Migrate

```bash
npm run prisma:migrate:deploy --workspace=backend
```
(equivalent to `prisma migrate deploy --schema=./prisma/schema.prisma` run from `backend/`) — applies only migrations not yet recorded as applied, in order, with no interactive prompts and no destructive `migrate reset`. This is the only migration command that belongs in a real deployment pipeline; `prisma migrate dev` is a local-development-only command and must never run against a production database.

Before running against production for the first time after adding a new migration, rehearse it: apply it to a copy/staging database, confirm `prisma:migrate:status` reports clean, and (for anything non-trivial) rehearse the rollback too — see `ROLLBACK_RUNBOOK.md`.

## Start

```bash
npm run start --workspace=backend
```
(`node dist/server.js`). Separately, ensure the scheduler process is running (`npx tsx src/scripts/run-scheduler.ts` from `backend/`, or its compiled equivalent) — this is what drives the backup schedule, the data-retention purge schedule, and job-queue draining (including the background data-export job type). The API server and the scheduler are two separate real processes; a deploy that restarts one without the other leaves scheduled work stalled until both are confirmed up.

## Readiness / health verification (do this before considering a deploy complete)

1. `GET /health/live` — pure liveness, must return `200` with no dependency checks. If this fails, the process itself didn't start correctly; check startup logs (most likely cause: a failed env-var validation, per the pre-deployment checklist).
2. `GET /health/ready` — real dependency checks (`database`, `jobQueue`, reported independently). Must report both reachable/healthy before routing real traffic to this instance.
3. **Smoke test**: a small set of real, low-risk read requests against the new deployment (e.g. an authenticated `GET /admin/dashboard` with a real test account, or the equivalent for a non-admin flow) — confirming the app is not just "up" but actually serving real data correctly, since `/health/ready` alone does not exercise application logic.
4. Only after 1-3 pass, cut real user traffic over (however your load balancer / DNS / platform performs a cutover) — do not route production traffic to an instance that hasn't passed its own readiness check.

## Post-deployment

1. Watch `GET /admin/alerts` for the first several minutes after cutover — an `high_api_error_rate` or `high_latency` alert appearing shortly after a deploy is a strong, fast signal something is wrong with the new version specifically.
2. Confirm the backup and retention schedulers picked back up correctly (`GET /admin/backups`, `GET /admin/retention`) if the deploy involved a scheduler-process restart.
3. If anything looks wrong, do not "wait and see" past a few minutes on a genuinely broken signal — follow `ROLLBACK_RUNBOOK.md`.
