# Incident Response

> **Superseded by `docs/ops/INCIDENT_RESPONSE_RUNBOOK.md` as of Phase 33.** That document carries this one's content forward plus routing to the newer specialized runbooks (security, payment, AI-provider, deployment, rollback). Kept here unmodified for historical reference — do not delete.

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** general incident procedure, cross-referencing the more specific backup/restore/DR runbooks where relevant.

## Severity classification

| Severity | Definition | Examples |
|---|---|---|
| **SEV1** | Real customer data loss or a fully-down production API | Database instance lost; `/health/ready` failing for all traffic |
| **SEV2** | Degraded but functional; a real risk is building | Backups failing (`UNHEALTHY` in `GET /admin/backups`); elevated error rate; one dependency down (AI provider, Stripe) with graceful degradation holding |
| **SEV3** | A real defect with no current customer impact | A found-but-not-yet-triggered bug; a stale (but not yet unhealthy) backup |

## Immediate steps (any severity)

1. **Confirm it's real** — check `GET /health/live`, `GET /health/ready`, and `GET /admin/backups` for real, current signal before acting. Don't act on a single anomalous data point; check for a pattern.
2. **Classify severity** using the table above.
3. **Note the real start time** — you will need this for a real, accurate incident timeline and (if data was lost) a real RPO measurement for this specific incident.
4. **Route to the right runbook:**
   - Data loss / corruption / database unreachable → `docs/ops/DISASTER_RECOVERY_RUNBOOK.md`
   - Backup system itself unhealthy → `docs/ops/DISASTER_RECOVERY_RUNBOOK.md`'s "backups themselves are failing" section
   - Need to actually restore something → `docs/ops/RESTORE_RUNBOOK.md`
   - A dependency (AI provider, Stripe, DB) is down but the app is still up → see Phase 30's Failure Matrix work (`docs/PHASE_30_PRODUCTION_HARDENING_CERTIFICATION.md`, Track C)

## Escalation procedure

This is a small, single-operator-appropriate system as of Phase 31 — "escalation" today means:

1. **Any action that is genuinely irreversible relative to current state** (restoring OVER live `public` data, not into an isolated schema; deleting a backup artifact manually outside the real retention cleanup path) requires a deliberate, conscious decision — not a reflexive one during a stressful incident. Stop, write down what you're about to do and why, and re-read the relevant runbook's warnings before proceeding.
2. **If more than one person operates this system**, the real, current owner of a production decision must be unambiguous before an irreversible action — agree on that explicitly before proceeding, not after.
3. **Every SEV1 and SEV2 incident gets a real, written postmortem** after resolution: what happened, when detected, when resolved, real root cause, what changed as a result. Perfect information isn't required to start one — start it during the incident if you can, finish it within 48 hours.

## After the incident

1. Confirm real, current health: `GET /health/ready`, `GET /admin/backups`, and — if data was touched — a real spot-check of the specific rows/tables affected.
2. If backups were affected or paused during the incident, trigger a manual one (`POST /admin/backups/trigger`) and confirm it succeeds before considering the incident closed.
3. Write the postmortem (see above). Update the relevant runbook if the incident revealed a real gap in it — these documents are only as good as their track record of matching real incidents.

## What this document is not

This is not a legal, compliance, or customer-communication playbook — those are real, separate needs this project has not yet built (see `docs/TRUST_SECURITY_COMPLIANCE_ARCHITECTURE.md` for what compliance groundwork does exist). If an incident involves real customer data exposure, treat that as a distinct, higher-priority thread alongside the technical recovery work described here.
