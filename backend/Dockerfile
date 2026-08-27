# Phase 19 Section 9/10: production-grade backend image.
#
# RUNTIME-VERIFIED as of Phase 33 — Docker became available in this
# environment for the first time this phase. A real `docker build` produced
# a working image; a real `docker run` (NODE_ENV=production, real generated
# secrets, DATABASE_URL pointed at the real dev Postgres over
# host.docker.internal) started cleanly and served real 200 responses from
# both /health/live and /health/ready (database: reachable, jobQueue:
# reachable) — see docs/PHASE_33_PRODUCTION_LAUNCH_CERTIFICATION.md Track I
# for the exact recorded output. The production env-var guardrails
# (rejecting localhost CORS_ORIGIN and dev-placeholder JWT secrets under
# NODE_ENV=production) were also confirmed firing correctly on a first,
# deliberately-misconfigured run before being corrected.

# ---- deps: install once, reused by both the build and prune stages ----
FROM node:20.11-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Phase 23 Section 3: a real `docker build` found this file was missing —
# backend/tsconfig.json's `"extends": "../tsconfig.base.json"` silently
# fails to resolve without it (TypeScript does not error on a missing
# `extends` target; it just falls back to compiler defaults), which meant
# `strict`, `esModuleInterop`, and `skipLibCheck` were ALL silently dropped
# inside the container — explaining a wide, seemingly-unrelated spread of
# type errors (esModuleInterop-dependent imports, ambient .d.ts errors from
# devDependencies that skipLibCheck should have suppressed, and stricter
# discriminated-union/optional-field inference) that never appeared in any
# local build, because a local checkout always has this file on disk.
COPY tsconfig.base.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --workspace=backend --include-workspace-root

# ---- build: generate the Prisma client, then compile TypeScript ----
# Phase 23 Section 3: a real `docker build` found these two RUN lines were
# previously in the wrong order. `npm run build -w backend` is `tsc`, a
# type-check — `@prisma/client`'s actual model types (WorkflowInstance,
# WorkflowInstanceStatus, Prisma.InputJsonValue, etc.) don't exist until
# `prisma generate` has written them into node_modules/.prisma/client;
# before that, the package resolves to an empty default blueprint. Running
# `tsc` first meant every file importing a generated model type failed with
# "has no exported member '...'" — this never surfaced locally because a
# developer's node_modules/.prisma/client already has the generated types
# from a prior local `prisma generate` run, but a fresh container image
# build starts with none.
FROM deps AS build
WORKDIR /app
# Phase 33: `prisma generate`'s "native" binary target is resolved from the
# libssl actually detected in THIS stage at generate time. The first real
# `docker build` had no openssl installed here, so "native" silently
# resolved to the openssl-1.1.x fallback engine; a later fix installed real
# openssl-3.0.x in the `runtime` stage only, so the shipped 1.1.x-built
# engine could no longer load against runtime's real 3.0.x libssl — the
# container built successfully but crashed on every request with "query
# engine library not found" (unhandledRejection). Installing the SAME real
# openssl version here, before `prisma generate` runs, makes "native"
# resolve correctly to debian-openssl-3.0.x, matching the runtime stage.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY backend/ ./backend/
RUN npx prisma generate --schema=./backend/prisma/schema.prisma
RUN npm run build -w backend

# ---- prune: production-only node_modules, no devDependencies ----
FROM node:20.11-bookworm-slim AS prune
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=backend --omit=dev --include-workspace-root

# ---- runtime: minimal final image ----
FROM node:20.11-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Phase 33: real openssl here too — see the matching install in the `build`
# stage above for the full story (generate-time and runtime-time libssl
# must match, or the shipped query engine binary fails to load).
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

# Non-root execution — never run the API as root inside the container.
RUN groupadd --system bizpilot && useradd --system --gid bizpilot --home /app bizpilot

# Phase 23 Section 3: a real `docker build` (not structural review) found
# this stage previously also tried `COPY --from=prune /app/backend/node_modules
# ./backend/node_modules` — that path never exists. `npm ci --include-workspace-root`
# in an npm-workspaces monorepo with only one real workspace installed
# (backend) hoists every dependency into the single root `/app/node_modules`;
# there is no separate per-workspace `node_modules` unless a version
# conflict forces a nested install, which doesn't happen here. The build
# failed with "failed to calculate checksum ... not found" the first time
# this Dockerfile was actually executed — copying the root node_modules
# below is sufficient on its own.
COPY --from=prune /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY backend/package.json ./backend/package.json

# Phase 23 Section 4: the `prune` stage's `npm ci --omit=dev` never invokes
# `prisma generate` — it has no `prisma` CLI available (a devDependency) and
# this package.json has no `postinstall` hook, so its node_modules lacks the
# generated query-engine client entirely. Without this line the container
# builds and starts cleanly (the missing client only breaks the FIRST
# Prisma call, not startup) but crashes on the first real database query
# with "@prisma/client did not initialize yet. Please run `prisma generate`"
# — a structural defect found by review, not by an actual `docker run`
# (Docker was unavailable when this fix was authored). Copies the already-
# correctly-generated client straight from the `build` stage instead of
# regenerating it a third time.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Phase 33: a real `docker run` of the scheduler process found the backup
# job failing with "EACCES: permission denied, mkdir 'backups'" — every
# COPY above runs as root by default, so /app ended up root-owned, and
# BACKUP_DIR/EXPORT_DIR's relative default paths (./backups, ./exports)
# need to create a new directory under the non-root `bizpilot` user at
# runtime. This never surfaced outside a container: a local/dev run always
# executes as the host user, who already owns the project directory.
RUN chown -R bizpilot:bizpilot /app

USER bizpilot
WORKDIR /app/backend

EXPOSE 4000

# Distinct from HTTP /health/ready (which also checks the database) — this
# is Docker's own process-liveness probe, deliberately hitting the
# lightweight /health/live endpoint so a slow/unavailable database does not
# cause Docker to kill and restart an otherwise-healthy process.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health/live',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Plain `node`, not `npm start` — npm does not forward SIGTERM to the child
# process correctly, which would break the graceful-shutdown handling
# already implemented in src/server.ts (server.close + Prisma disconnect).
CMD ["node", "dist/server.js"]
