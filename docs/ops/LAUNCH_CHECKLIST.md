# Launch Checklist

**Audience:** an engineer preparing to launch BizPilot.Ai who has NOT worked on this codebase before. Every item below either links to a runbook with the real procedure, or is a real, directly-executable check. If you can't complete an item, its runbook explains why and what to do about it — you should not need to ask the original developer anything not already answered in `docs/ops/` or the phase certification documents (`docs/PHASE_30_*.md` through `docs/PHASE_34_*.md`).

## 1. Credentials — what's required, what's optional

| Credential | Required for launch? | If missing |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` | **Yes — the app will not boot without these** | N/A — not optional |
| `CORS_ORIGIN` matching your real frontend domain | **Yes** | Login/all API calls fail from the browser |
| `TRUST_PROXY` set correctly for your real proxy topology | **Yes if deploying behind any reverse proxy/load balancer** (the default of `1` matches the documented nginx-in-front-of-backend topology only) | IP-keyed rate limits collapse onto one shared bucket across all real users — see `env.ts`'s `TRUST_PROXY` doc comment |
| `BACKUP_ENCRYPTION_KEY` | Strongly recommended before real customer data exists | Backups run unencrypted — real functionality, real security gap |
| `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` | Recommended (off-site backup) | Backups stay local-disk-only — see `BACKUP_RUNBOOK.md`'s honest gap statement |
| `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` | Only if launching with real paid plans | `PAYMENT_PROVIDER=mock` remains a real, supported operating mode — see `PAYMENT_INCIDENT_RUNBOOK.md` |
| `OPENAI_API_KEY` | Only if launching with real AI generation (vs. the mock adapter) | `AI_PROVIDER=mock` remains a real, supported, demo-quality operating mode — see `AI_PROVIDER_INCIDENT_RUNBOOK.md` |
| `ALERT_WEBHOOK_URL` | Recommended before you stop actively watching the admin dashboard yourself | Alert detection still works (`GET /admin/alerts`); nothing pages anyone automatically |

Every one of these is validated by `backend/src/config/env.ts` at process startup — a missing REQUIRED one fails the boot immediately with a specific field-level error, never a silent misconfiguration.

## 2. Pre-deployment

- [ ] Full regression is green — see `docs/PHASE_34_PRODUCTION_LAUNCH_GROWTH_CERTIFICATION.md`'s exact counts for the last certified baseline; re-run before YOUR launch if meaningful time has passed.
- [ ] Every migration in `backend/prisma/migrations/` has been reviewed — see `DEPLOYMENT_RUNBOOK.md`'s migration-review step.
- [ ] `VERSION`, both `package.json` files, `package-lock.json`, and `CHANGELOG.md` agree on the same version (`grep` for the old version string across the repo — zero hits outside intentionally-historical docs).

## 3. Deploy

Follow `DEPLOYMENT_RUNBOOK.md` exactly: build → migrate → start API server AND scheduler process (two separate real processes — see `SCHEDULER_WORKER_RECOVERY.md` if you only start one and wonder why backups never run) → readiness verification → smoke test → cut traffic over.

## 4. Post-deployment verification (do this before calling it done)

- [ ] `GET /health/live` and `GET /health/ready` both real `200`s.
- [ ] `GET /admin/alerts` — empty, or only pre-existing known items.
- [ ] `GET /admin/backups` — a real manual trigger (`POST /admin/backups/trigger`) succeeds.
- [ ] `GET /admin/retention` — a real default schedule exists (`ensureDefaultRetentionSchedule` runs on scheduler startup).
- [ ] One real end-to-end customer journey in an actual browser against the real deployed instance: register → onboard → generate content (mock or real AI) → approve → check the dashboard → log out → log back in and confirm persistence. This is not optional — automated tests prove the code path works, not that YOUR specific deployment (real DNS, real CORS origin, real proxy config) is wired correctly.

## 5. Ongoing operational habits (not one-time)

- [ ] Someone is actually watching `GET /admin/alerts` (or has `ALERT_WEBHOOK_URL` configured) — an alert nobody sees is equivalent to no alert.
- [ ] Backup health is checked on a real cadence, not just at launch — `BACKUP_RUNBOOK.md`.
- [ ] Credential rotation is on a real schedule, not "whenever we remember" — `CREDENTIAL_ROTATION_RUNBOOK.md`.
- [ ] A real, current on-call/escalation contact exists for `INCIDENT_RESPONSE_RUNBOOK.md`'s "who owns an irreversible decision" requirement — this document cannot answer that for you; it's an organizational decision, not a technical one.

## 6. Where to go next for a specific problem

Every runbook under `docs/ops/`:

- `BACKUP_RUNBOOK.md`, `RESTORE_RUNBOOK.md`, `DISASTER_RECOVERY_RUNBOOK.md` — data protection and recovery.
- `INCIDENT_RESPONSE_RUNBOOK.md` — general triage and routing (start here if unsure).
- `SECURITY_INCIDENT_RUNBOOK.md` — suspected compromise, unauthorized access.
- `PAYMENT_INCIDENT_RUNBOOK.md`, `AI_PROVIDER_INCIDENT_RUNBOOK.md` — third-party dependency failures.
- `DATABASE_INCIDENT_RUNBOOK.md` — the primary Postgres instance is unreachable or degraded.
- `SCHEDULER_WORKER_RECOVERY.md` — the background job/scheduler process is down or crash-looping.
- `CREDENTIAL_ROTATION_RUNBOOK.md` — rotating any secret, routine or emergency.
- `CUSTOMER_SUPPORT_ESCALATION.md` — a real customer reported a problem; where to route it.
- `DEPLOYMENT_RUNBOOK.md`, `ROLLBACK_RUNBOOK.md` — shipping and un-shipping changes.

## Honest scope note

This checklist gets a competent engineer through a real launch of the ENGINEERING system. It does not cover legal/compliance sign-off, customer communication planning, or business decisions about credential provisioning timing — those are real, separate responsibilities this document does not attempt to own.
