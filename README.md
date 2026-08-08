# BizPilot AI

A production-grade AI SaaS platform. This repository is a monorepo containing the frontend application, backend API, and supporting documentation/assets.

> **Status:** Phase 1 — project scaffolding. Folder structure, tooling, and configuration are in place. Application entry points (UI, API routes, database schema) are intentionally not yet implemented and are added in subsequent phases.

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
- PostgreSQL `>= 15` (local instance or connection string)

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

   Then edit `backend/.env` with your PostgreSQL connection string, JWT secrets, and OpenAI API key.

3. **Generate the Prisma client** (once a schema is defined):

   ```bash
   npm run prisma:generate -w backend
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

## Common Scripts (from repo root)

| Command | Description |
| --- | --- |
| `npm run dev` | Run frontend and backend concurrently |
| `npm run build` | Build both workspaces for production |
| `npm run lint` | Lint both workspaces |
| `npm run format` | Format the entire repo with Prettier |
| `npm run format:check` | Check formatting without writing changes |

Each workspace also exposes its own scripts — run with `-w frontend` or `-w backend`, e.g. `npm run typecheck -w frontend`.

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
10. Feature UI implementation.
