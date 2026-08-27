# Incident Response Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** the general incident procedure and severity classification — routes to the specialized runbooks below for anything specific. Supersedes `docs/ops/INCIDENT_RESPONSE.md` (Phase 31), kept for history, not deleted.

## Severity classification

| Severity | Definition | Examples |
|---|---|---|
| **SEV1** | Real customer data loss or a fully-down production API | Database instance lost; `/health/ready` failing for all traffic; genuine security breach confirmed |
| **SEV2** | Degraded but functional; a real risk is building | Backups failing (`UNHEALTHY` in `GET /admin/backups`); elevated error rate; one dependency down (AI provider, Stripe) with graceful degradation holding; a real alert from `GET /admin/alerts` at `critical` severity |
| **SEV3** | A real defect with no current customer impact | A found-but-not-yet-triggered bug; a stale (but not yet unhealthy) backup; a `warning`-severity alert |

## Immediate steps (any severity)

1. **Confirm it's real** — check `GET /health/live`, `GET /health/ready`, `GET /admin/backups`, and `GET /admin/alerts` (Phase 33's real, live-evaluated alert feed — see below) for real, current signal before acting. Don't act on a single anomalous data point; check for a pattern.
2. **Classify severity** using the table above.
3. **Note the real start time** — you will need this for a real, accurate incident timeline and (if data was lost) a real RPO measurement for this specific incident.
4. **Route to the right runbook:**
   - Data loss / corruption / database unreachable → [`DISASTER_RECOVERY_RUNBOOK.md`](DISASTER_RECOVERY_RUNBOOK.md)
   - Backup system itself unhealthy → `DISASTER_RECOVERY_RUNBOOK.md`'s "backups themselves are failing" section
   - Need to actually restore something → [`RESTORE_RUNBOOK.md`](RESTORE_RUNBOOK.md)
   - Suspected unauthorized access, credential compromise, or a real security finding → [`SECURITY_INCIDENT_RUNBOOK.md`](SECURITY_INCIDENT_RUNBOOK.md)
   - Payment/billing/Stripe webhook failure or anomaly → [`PAYMENT_INCIDENT_RUNBOOK.md`](PAYMENT_INCIDENT_RUNBOOK.md)
   - AI provider outage, timeout, or credit-charging anomaly → [`AI_PROVIDER_INCIDENT_RUNBOOK.md`](AI_PROVIDER_INCIDENT_RUNBOOK.md)
   - A deployment is in progress or just went out and something looks wrong → [`DEPLOYMENT_RUNBOOK.md`](DEPLOYMENT_RUNBOOK.md) and [`ROLLBACK_RUNBOOK.md`](ROLLBACK_RUNBOOK.md)

## Alert-driven detection (Phase 33)

`GET /admin/alerts` evaluates real, current system state on every call (backup health, restore-verification health, scheduler staleness, dead-letter job growth, stuck jobs, database reachability, HTTP error rate, HTTP p95 latency, AI failure rate — see `backend/src/modules/alerting/alerting.service.ts`) and returns a real list of currently-true alerts, never a static/example list. The admin dashboard's "Live alerts" panel polls this every 30s. **Alert delivery (an actual webhook POST) requires `ALERT_WEBHOOK_URL` to be configured** — absent that, alerts are still detected and visible via the API/dashboard, but nothing pages anyone automatically. As of this writing `ALERT_WEBHOOK_URL` is not set in this environment: `BLOCKED — CREDENTIAL` for the delivery leg specifically, not for detection.

## Escalation procedure

This is a small, single-operator-appropriate system — "escalation" today means:

1. **Any action that is genuinely irreversible relative to current state** (restoring OVER live `public` data, not into an isolated schema; deleting a backup artifact manually outside the real retention cleanup path; running a manual data-retention purge outside the normal schedule) requires a deliberate, conscious decision — not a reflexive one during a stressful incident. Stop, write down what you're about to do and why, and re-read the relevant runbook's warnings before proceeding.
2. **If more than one person operates this system**, the real, current owner of a production decision must be unambiguous before an irreversible action — agree on that explicitly before proceeding, not after.
3. **Every SEV1 and SEV2 incident gets a real, written postmortem** after resolution: what happened, when detected, when resolved, real root cause, what changed as a result. Perfect information isn't required to start one — start it during the incident if you can, finish it within 48 hours.

## After the incident

1. Confirm real, current health: `GET /health/ready`, `GET /admin/backups`, `GET /admin/alerts` (expect an empty list, or only pre-existing known items), and — if data was touched — a real spot-check of the specific rows/tables affected.
2. If backups were affected or paused during the incident, trigger a manual one (`POST /admin/backups/trigger`) and confirm it succeeds before considering the incident closed.
3. Write the postmortem (see above). Update the relevant runbook if the incident revealed a real gap in it — these documents are only as good as their track record of matching real incidents.

## What this document is not

This is not a legal, compliance, or customer-communication playbook — those are real, separate needs this project has not yet built (see `docs/TRUST_SECURITY_COMPLIANCE_ARCHITECTURE.md` for what compliance groundwork does exist). If an incident involves real customer data exposure, treat that as a distinct, higher-priority thread alongside the technical recovery work described here — see `SECURITY_INCIDENT_RUNBOOK.md`.
