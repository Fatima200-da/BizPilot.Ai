# Architecture

BizPilot AI is a monorepo with two independently deployable applications, managed as npm workspaces.

## Repository Layout

```
bizpilot-ai/
├── frontend/     React 19 + TypeScript + Vite SPA
├── backend/      Node.js + Express + Prisma API
├── docs/         Architecture and API documentation
├── database/     Migration/seed reference material (source of truth schema lives in backend/prisma)
├── assets/       Brand and marketing assets (not bundled into the app)
└── prompts/      Versioned AI prompt templates used by the backend OpenAI integration
```

## Frontend (`frontend/`)

Feature-based structure under `src/`:

- `app/` — application shell: providers (React Query, routing) and router configuration.
- `features/<feature>/` — self-contained vertical slices (`api/`, `components/`, `hooks/`, `pages/`, `schemas/`, `types/`). Each feature owns its own data-fetching, validation, and UI.
- `shared/` — cross-feature building blocks, no feature-specific logic:
  - `components/ui/`, `components/feedback/`, `components/overlay/`, `components/layout/` — the design system (see [docs/design-system](design-system/README.md)), layered so `ui` has no dependency on the other three.
  - `hooks/`, `lib/`, `types/`, `utils/`, `constants/`.
- `config/` — environment and runtime configuration.
- `assets/` — bundled static assets (icons, images, fonts).
- `styles/` — Tailwind entry point (`index.css`), design tokens (`theme.css`), global resets (`base.css`).

Path alias `@/*` resolves to `src/*`.

## Backend (`backend/`)

Layered, module-oriented structure under `src/`:

- `modules/` — feature modules (e.g. `auth`, `users`, `ai`), each following its own internal layering (routes → controllers → services → repositories) once implemented.
- `common/` — cross-cutting concerns: middlewares, error types, shared utilities, and constants.
- `infrastructure/` — integrations with external systems: `database/` (Prisma client), `openai/` (AI provider client), `storage/` (file upload handling via Multer).
- `config/` — environment variable loading and validation.

Prisma schema lives at `backend/prisma/schema.prisma`. Data models are added in the database design phase.

## Conventions

- Strict TypeScript everywhere (`tsconfig.base.json` defines the shared strict compiler baseline).
- ESLint (flat config) + Prettier enforced per workspace.
- Clean Architecture boundaries: features/modules depend on `shared`/`common`, never the reverse.
- No cross-feature imports — shared logic is promoted to `shared/` (frontend) or `common/` (backend).
