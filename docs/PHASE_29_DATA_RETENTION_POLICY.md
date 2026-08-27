# Phase 29 — Data Retention Policy

**Scope:** an audit of every table in `schema.prisma` that grows without bound as the product is used, a decision on what's safe to retention-limit versus what must be kept, and an honest statement of what is (and is not) enforced today.

**Status discipline (unchanged from every prior phase):** `VERIFIED` (real execution observed), `DECIDED` (a real policy decision has been made and documented, but automated enforcement is deliberately not built yet), `DEFERRED` (explicitly postponed, with a stated reason), `NOT ATTEMPTED`. A policy decision is never silently upgraded to "enforced."

---

## 1. Why enforcement is deliberately deferred, not silently skipped

BizPilot.Ai has no real paying customers yet and no real production usage volume to size retention windows against. Shipping an automated, irreversible deletion job against a live database before there is real usage data to validate it against — and before a tested, verified backup/restore path exists for the specific tables it touches — is itself a production risk, not a safety measure. Phase 29 Section 21 already establishes the backup/restore rehearsal; automated retention enforcement is the natural next phase once that rehearsal has run against realistic data volumes.

**`RETENTION_ENFORCEMENT = DEFERRED`** — deliberately, for the reason above. Every classification below is a real, documented decision (`DECIDED`), not a guess deferred by omission.

## 2. Classification

| Table | Growth driver | Contains sensitive data? | Business/compliance need | Recommended retention | Enforcement |
|---|---|---|---|---|---|
| `AuditLog` | every admin action, subscription change, credit adjustment | actor id, before/after JSON (no secrets — see `error-handler.ts`/audit call sites, never raw provider payloads) | compliance record of who-did-what — the system's real accountability trail | **indefinite**, until real legal/compliance guidance sets a window | none — must not be pruned without that guidance |
| `Invoice` / `InvoiceItem` / `Payment` | one row per billing cycle per workspace | billing amounts, no card numbers (Stripe holds those) | financial record — needed for disputes, accounting, potential tax obligations | **indefinite** (financial records; a real accountant/legal review should set the final window, not an engineering guess) | none |
| `AIUsage` | every AI call, per workspace | token counts, cost, no raw prompt content | billing-dispute evidence for credit charges | **≥ 24 months**, tied to how long `Invoice` disputes stay open | not enforced — `DECIDED`, `DEFERRED` |
| `WebhookEvent` | every Stripe webhook delivery, including retries | Stripe event id/type, resolved workspace — no card data | idempotency guard (Phase 25/28) + replay-attack defense (Phase 28's timestamp-tolerance check already handles replay independently of how long rows are kept) | **90 days** — well past Stripe's own retry window and the 300s replay-tolerance window | not enforced — `DECIDED`, `DEFERRED` |
| `Job` / `ScheduledJobRun` | every scheduled/background job execution | payload may reference workspace ids, no secrets (Section 8 of Phase 28 already restricts logged fields to identifiers) | operational trace; `FAILED` (dead-letter) rows are the Section 9 admin recovery surface | terminal `COMPLETED`/`CANCELLED`: **30–90 days**. `FAILED`: **90 days** (postmortem window) | not enforced — `DECIDED`, `DEFERRED` |
| `WorkflowStepRun` | every workflow step attempt | step output may include generated business content | supports Section 10's retry/inspect flow and traces exactly what a workflow produced | tie to the parent `WorkflowInstance` — **keep as long as the instance's real business output (`ContentAsset`) is still referenced by the customer** | not enforced — `DECIDED`, `DEFERRED` |
| `Notification` | every notification event fired (Section 14 added 3 more types this phase) | title/body only, no secrets | UX — the bell/list surface; read notifications lose value fast | **180 days**, independent of read/unread state | not enforced — `DECIDED`, `DEFERRED` |
| `ProductEvent` | every tracked event (Section 4/5 — 24 event names, both server- and client-fired) | workspace/user id, event name, small properties JSON — **never** passwords/tokens/API keys/raw prompts (enforced by `trackEvent`'s own call sites, verified in `product-event.integration.test.ts`) | activation-metrics engine (Section 6) needs real history to compute rates | **13 months** (supports a year-over-year comparison plus buffer) | not enforced — `DECIDED`, `DEFERRED` |
| `Activity` | every activity-feed event, workspace-scoped | human-readable summary only (explicitly documented in-schema as "NOT the compliance record — see AuditLog") | customer-facing feed, not a compliance artifact | **180 days**, same reasoning as `Notification` | not enforced — `DECIDED`, `DEFERRED` |
| `Feedback` | one row per customer submission (Section 24, this phase) | free-text message, workspace/user id | product-learning input (Section 27/28); low volume — an MVP will not generate enough feedback for this to be a real storage concern | **indefinite** for now — revisit once volume is real | none needed yet |
| `Session` | one row per login, already has `expiresAt` + a real index on it | token hash, user agent, IP | auth — expired/revoked rows are pure dead weight once past `expiresAt` | delete where `revokedAt IS NOT NULL OR expiresAt < now() - 30d` | not enforced — `DECIDED`, `DEFERRED`, lowest-risk candidate for the first real cleanup job (already indexed, no business-data loss possible) |
| `TeamInvite` | one row per invite sent, has `expiresAt` + index | invitee email, role | low volume — one per team invite, not a growth concern at MVP scale | expired + already-accepted/declined: **90 days** | none needed yet |

## 3. What is explicitly NOT in scope for this phase

- No table is truncated, deleted, or altered by this phase's work. This is a policy document only.
- No cron job, scheduled task, or admin "purge" endpoint was added. Building one now — before Phase 29's own backup/restore rehearsal (Section 21) has run and before there's real usage volume to test a deletion job against — would itself be the kind of premature, unverified production risk this certification process exists to catch.
- The two lowest-risk, highest-confidence future candidates (`Session` cleanup, `WebhookEvent` pruning past 90 days) are flagged above as the natural starting point for a future phase, specifically because they carry no compliance ambiguity and no customer-visible business data.

**`DATA_RETENTION_POLICY = DECIDED AND DOCUMENTED`. `DATA_RETENTION_ENFORCEMENT = DEFERRED` (reasoned, not silent).**
