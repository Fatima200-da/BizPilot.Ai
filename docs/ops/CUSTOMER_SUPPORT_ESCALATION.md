# Customer Support Escalation Runbook

**Audience:** whoever operates BizPilot.Ai in production, when a real customer reports a problem. **Scope:** triaging and routing a customer-reported issue to the right internal runbook — this document does not duplicate technical recovery steps, it routes to them.

## First: confirm it's real and get the right facts

Before touching anything, get from the customer (or from your own real, direct verification):

- The exact workspace and/or user account affected (email is usually enough — every real resource in this system is tenant-scoped by `workspaceId`, so knowing which workspace matters for every subsequent step).
- What they expected to happen vs. what actually happened.
- When it happened (a real timestamp, even approximate, narrows which logs/alerts/backups are relevant).
- Whether it's still happening now, or already resolved on its own.

Verify directly rather than trusting the report alone where you can — `GET /admin/dashboard`, `/admin/users`, `/admin/workspaces` (real, already-built admin search) let you look at the actual current state of their account without guessing.

## Routing table

| Customer report | Route to |
|---|---|
| "I can't log in" / "my password isn't working" | Check `Session`/`PasswordResetToken` state directly first (real, fast diagnosis: is their account genuinely locked by rate limiting — `SECURITY_INCIDENT_RUNBOOK.md` — or do they just have the wrong password). If genuinely broken, `SECURITY_INCIDENT_RUNBOOK.md`. |
| "I was charged incorrectly" / "my plan doesn't match what I'm paying for" | `PAYMENT_INCIDENT_RUNBOOK.md` |
| "My AI generation failed" / "I got charged but didn't get a result" | `AI_PROVIDER_INCIDENT_RUNBOOK.md` — check their real `AIUsage` rows first (ground truth for what was actually charged) |
| "My data disappeared" / "a workspace/content/contact is missing" | Do NOT assume data loss — first check `deletedAt`-based soft-delete state directly (most "missing" data in this system is soft-deleted, not gone) and real data-retention purge eligibility (`GET /admin/retention`). Only escalate to `DISASTER_RECOVERY_RUNBOOK.md` if it's genuinely gone, not soft-deleted or correctly purged per policy. |
| "I invited someone and they can't join" / "an invitation isn't working" | Check the real `WorkspaceInvitation` row (status, expiry, the exact email it was sent to — a mismatched email is the most common real cause) before assuming a bug |
| "The app is slow" / "pages won't load" | Check `GET /health/ready`, `GET /admin/alerts` for `high_latency`/`high_api_error_rate` first — if those are clean, it may be client-side/network on the customer's end, not a real platform issue |
| "I want my data exported" / GDPR-style request | The real, already-built customer data export (`GET /workspaces/:id/export` synchronous, or the Phase 33 background variant) — this is a self-service feature; only escalate if it's genuinely failing |
| Anything involving a real security concern (unauthorized access, suspicious activity) | `SECURITY_INCIDENT_RUNBOOK.md` immediately — do not investigate casually in a support thread; treat as a real incident from the first report |

## What to tell the customer

Match the honesty discipline this whole system is built on: never promise something isn't true, never fabricate a timeline you don't have real evidence for. If you don't yet know the cause, say so and give a real next-check-in time rather than guessing. If their data is genuinely safe (soft-deleted, not purged, or simply mis-navigated to), say so plainly and specifically — vague reassurance is not the same as a real, checked fact.

## Escalating internally

Any report that turns out to touch real data integrity, real security, or real payment correctness gets the SEV classification and postmortem treatment from `INCIDENT_RESPONSE_RUNBOOK.md`, even if the customer-facing resolution was quick — the internal record matters for pattern-spotting across multiple reports.
