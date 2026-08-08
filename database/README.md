# Database

The Prisma schema (source of truth for the data model) lives at `backend/prisma/schema.prisma`, and Prisma-generated migrations are written to `backend/prisma/migrations/` when `npm run prisma:migrate -w backend` is run.

This top-level `database/` directory holds supporting material that isn't part of the Prisma toolchain output:

- `migrations/` — reference copies of hand-reviewed SQL (e.g. for manual review or DBA sign-off), if needed.
- `seeds/` — seed data fixtures used to populate development/staging databases.

No schema or migrations exist yet — the data model is defined in a later phase.
