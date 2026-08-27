# Phase 19 Section 9/10: production-grade frontend image — a static build
# served by a minimal Nginx, not a Node process (the SPA needs no runtime).
#
# Phase 23: runtime-verified via real `docker build` — see
# docs/PHASE_23_PRODUCTION_DEPLOYMENT_CERTIFICATION.md.

FROM node:20.11-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Phase 23 Section 4: a real `docker build` found this file was missing —
# identical root cause to backend/Dockerfile's fix. frontend/tsconfig*.json
# extends `../tsconfig.base.json`, which silently falls back to defaults
# (dropping strict/esModuleInterop/skipLibCheck) when the file doesn't
# exist, producing a wide, misleading spread of unrelated-looking type
# errors across node_modules' own ambient .d.ts files.
COPY tsconfig.base.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
RUN npm ci --workspace=frontend --include-workspace-root
COPY frontend/ ./frontend/
# VITE_API_BASE_URL must be supplied at build time (Vite inlines env vars
# into the static bundle at build, not run, time) — see
# docs/PRODUCTION_ENVIRONMENT.md for the per-environment value.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build -w frontend

FROM nginx:1.27-alpine AS runtime
# Phase 23: `.template` in the official image's templates/ directory is
# auto-rendered via envsubst into conf.d/ at container start — see
# nginx.conf.template's own doc comment for exactly why.
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/frontend/dist /usr/share/nginx/html

# Default so the container still starts (proxying to itself, effectively a
# 502 until overridden) if BACKEND_UPSTREAM isn't set — a same-origin /api
# deployment must override this at `docker run -e` / compose time.
ENV BACKEND_UPSTREAM=backend:4000

# nginx:alpine already runs its worker processes as the unprivileged
# `nginx` user by default; the master process needs root only to bind
# port 80 and read the (world-readable, non-secret) static files below it.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O- http://localhost:80/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
