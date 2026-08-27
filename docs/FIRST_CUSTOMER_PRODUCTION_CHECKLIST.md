# First-Customer Production Checklist (Phase 21, updated Phase 22)

Evidence for the exact journey a first real customer takes, end to end. Every row cites either the automated Playwright suite (`e2e/golden-path.spec.ts`, 9/9 passing) or a live manual session.

**Phase 22 update**: the entire journey below has now been additionally re-verified against a **real, credentialed, networked PostgreSQL 18 server** (`bizpilot_app@bizpilot_ai_dev`) — not just PGlite. The Playwright 9/9 suite passed against the real server, and a separate live session (register → workspace → business profile → Marketing Autopilot → approve → persist → restart the backend process → login again → retrieve the workflow) confirmed persistence survives a genuine process restart against real Postgres. See `docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md` Sections 8, 11-12 for exact evidence. The "Known scope limitations" section below is updated accordingly — the PGlite-vs-real-Postgres gap is now closed.

| Step | Evidence | Status |
|---|---|---|
| Register | Playwright test 1; live: `POST /auth/register` → 201, real bcrypt hash, real JWT | VERIFIED |
| Login | Playwright (implicit in resume tests); live: `POST /auth/login` → 200 with a fresh access token | VERIFIED |
| Workspace creation | Playwright test 1; live: `POST /workspaces` → 201, OWNER role correctly assigned (`roleKey":"OWNER"` in the minted token) | VERIFIED |
| Onboarding → Business Profile | Playwright test 1 (business profile created as part of the golden path) | VERIFIED |
| Dashboard | Playwright test 1 (dashboard load path exercised); perf-smoke measures its real latency | VERIFIED |
| Marketing Autopilot: Generate | Playwright test 1 (workflow started, reaches AWAITING_APPROVAL against the mock AI provider) | VERIFIED (mock-provider scope — see AI Provider Certification) |
| Review | Playwright test 2 (edit a content asset caption) | VERIFIED |
| Approve | Playwright test 2 (individual + whole-plan approval); live concurrency proof: `marketing-autopilot.integration.test.ts`'s Section 8.2 test (exactly one 200, one 409 under real `Promise.all` concurrency) | VERIFIED |
| Persist | Playwright test 3 (browser refresh preserves the approved plan and edited caption) — proves persistence isn't just in-memory client state | VERIFIED |
| Logout | Playwright test 8 (logout clears session, returns to login) | VERIFIED |
| Login again | Same as Login row above | VERIFIED |
| Resume existing plan | Playwright test 4 (navigating to Marketing Autopilot resumes the existing approved plan instead of re-showing the start form) — this was the Phase 18 gap closed in Phase 19, re-verified live and unchanged this phase | VERIFIED |
| Edit/Review after resume | Covered by test 2's edit path combined with test 4's resume path (both green in the same suite run) | VERIFIED |
| Final state correctness | Live: `content asset list` endpoint returns exactly the expected count with no duplicates (Phase 20's idempotency fix, re-confirmed in the 49-test suite this phase) | VERIFIED |

## No fake data / no demo-only assumptions
- All data in the above evidence was created live via real HTTP requests against a real Postgres-wire-protocol engine (not hardcoded fixtures returned unconditionally) — confirmed by the mass-assignment probe (Section 14 of the main certification doc) showing the server independently computed and returned the correct `workspaceId`, not an echo of client input.
- No broken refresh: Playwright test 3 explicitly reloads the browser mid-session and re-asserts state from the server, not from client-side cache alone.
- No lost state: the resume test (4) starts a fresh browser navigation (not a SPA route change) and still recovers the correct in-progress plan from the database.
- No unexplained 500: this phase's live probing found and fixed exactly one 500 (the `USE_PGLITE_ADAPTER` boolean-coercion bug, `docs/PHASE_21_PRODUCTION_RELEASE_CERTIFICATION.md` Section 12) — the golden path produces zero 500s after that fix, confirmed by both the Playwright suite and live curl probing.
- No unauthorized access: cross-tenant and cross-role probes (Sections 11–12 of the certification doc) all returned the correct 404/403, never leaking or permitting access.

## Known scope limitations, stated plainly
- ~~The entire journey above has been proven against PGlite... not a real networked, credentialed PostgreSQL server~~ **Closed in Phase 22.** The journey is now verified against a real, credentialed, networked PostgreSQL 18 server, with persistence proven across a genuine backend process restart. See `docs/PHASE_22_REAL_POSTGRES_CERTIFICATION.md`.
- Still open: no deployment rehearsal has ever run inside a container (Docker unavailable in this environment) — the real-Postgres verification above is against a local development-grade server process, not a containerized production deployment.
- Marketing Autopilot's AI step runs on `AI_PROVIDER=mock` — deterministic fixture content, not real AI output. A first customer would see the same fixture content every run until a real provider credential is configured.
- No real payment/billing flow exists yet — the credit ledger tracks usage but there is no real Stripe/payment-provider integration in this codebase.
