# Phase 30 Track D — Disaster Recovery Certification

**Status discipline (unchanged from every prior phase):** `VERIFIED` (real execution observed), `DEFERRED` (a real decision, deliberately postponed, with a stated reason), `BLOCKED — ENVIRONMENT`. Never marked `VERIFIED` from reading code alone.

---

## Method

Same real, documented substitution established in Phase 29 (`backup-restore-rehearsal-phase29.ts`) for Phase 28's Docker-based `pg_dump`/`psql` method — neither the Docker daemon nor native `pg_dump`/`psql` binaries are available in this session. Extended this phase to cover **every real table** (50, not a 7-table representative sample) using a genuinely computed, not hand-ordered, restore sequence.

1. Real schema DDL replay: all 10 migration files (335 statements) into an isolated schema (`restore_verify_p30`) in the real dev database.
2. Real FK dependency graph queried from `pg_constraint` (not `information_schema`'s join-prone views — see script header for the real bug this caught: a naive join produced a fabricated 18-table "cycle" that did not exist).
3. A real topological sort (Kahn's algorithm) computes the safe insertion order — not a hand-maintained list.
4. Every column restored by explicit name and type — not a blind row-cast — after real execution found that approach silently shifts values into the wrong columns for any table whose two schema copies have different *physical* column order (found on `workspace_settings`, whose onboarding-state columns were added by a later migration).
5. Genuine circular FK references detected and handled correctly (insert NULL, restore the real value once both sides exist) rather than either failing or silently corrupting data.
6. Verification: exact row count for every one of the 50 tables, plus index and constraint counts.

## Real defects found and fixed while building this certification

1. **A fabricated FK cycle** from an `information_schema` view join without a `constraint_name`-plus-`table_name` qualifier — fixed by switching to the raw `pg_constraint`/`pg_class` catalog, which gives the referenced table directly via `confrelid`.
2. **A genuine circular FK** (`prompts.currentVersionId` ↔ `prompt_versions.promptId` — a real "current version pointer" design, not a bug) that a naive topological sort cannot order. Real handling: detect it, confirm the column is nullable, insert with it NULL, fix it up in a second pass once both tables have real rows. Two more of the same class were found (`business_profiles.logoFileId` → `files`, `ai_usages.promptId` → `prompts`), all correctly nullable and correctly handled the same way.
3. **A real data-corruption risk** in the row-cast restore technique itself (safe for Phase 29's 7 hand-picked tables, not safe universally): `(t::text::schema.table).*` relies on both schemas' physical column order being identical, which is not guaranteed when a table's columns were added across multiple migrations. Found via real execution (`workspace_settings` restored with a value shifted into the wrong column), fixed by switching every table to explicit named-and-typed column selection.
4. **Array-of-enum columns** (e.g. `webhooks.eventTypes: WebhookEventType[]`) needed their own cast form (`col::text::schema."Type"[]`, stripping Postgres's internal `_` array-type prefix) — enum scalar columns and enum array columns are not the same case.

## Results

**`BACKUP_RESTORE_CERTIFICATION = VERIFIED`** — full 50-table restore, 8,075 real rows, **zero row-count mismatches**, indexes and constraints match exactly (the one raw-count difference — `_prisma_migrations`, Prisma's own deploy-tooling bookkeeping table, never represented in any migration.sql file — is fully explained and named, not silently waved away).

## RTO (Recovery Time Objective) — real measurement

| Phase | Time |
|---|---|
| Schema restore (DDL, 335 statements) | 441ms |
| Data restore (50 tables, 8,075 rows) | 370ms |
| **Total measured** | **811ms (0.8s)** |

This is a real measurement against this environment's current data volume — the first of its kind in this project's history (every prior phase's backup/restore work verified correctness, not speed). It will grow with real production data volume, and does not yet include the time to provision a fresh database server/container from scratch, which a complete real-world RTO must also account for. As a first-order estimate for launch: at this data volume, the actual data-layer recovery is not the bottleneck — infrastructure provisioning time would dominate a real incident.

## RPO (Recovery Point Objective) — honestly not measured

RPO cannot be measured today because **no automated backup schedule exists yet** — a deliberate Phase 29 decision (`PHASE_29_DATA_RETENTION_POLICY.md`'s `DATA_RETENTION_ENFORCEMENT = DEFERRED`, reasoned there as: shipping automated deletion/backup jobs before a real rehearsal exists and before real usage volume can size them is itself a risk). Today, RPO is effectively **unbounded** — it equals however long it has been since a human last ran a manual backup.

**Recommended (not measured) target** once automated backups exist: RPO ≤ 24h via a daily scheduled `pg_dump`, tightened as real customer volume and business risk tolerance justify more frequent backups (e.g., hourly once paying customers depend on data freshness).

## What remains before this is a complete disaster-recovery story

- An automated backup schedule (the concrete next step this RPO recommendation points to).
- A rehearsal against a genuinely separate database/server (this method, by necessity, restores into an isolated schema in the *same* database instance — real proof of schema/data fidelity, but not proof that a brand-new server can be provisioned and reach a restorable state, which is the other half of a real RTO).
- Both of the above require either Docker or a second real Postgres instance, neither available this session — tracked, not silently dropped.
