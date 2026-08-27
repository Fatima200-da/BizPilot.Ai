# Credential Rotation Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** rotating each real secret this system depends on — routine rotation (a security best practice, done on a schedule) and emergency rotation (a suspected compromise — see `SECURITY_INCIDENT_RUNBOOK.md` for the incident-response side of that).

## The real secret inventory

Every secret below is validated at startup by `backend/src/config/env.ts`'s Zod schema — the app refuses to boot on a missing/malformed required one, so a rotation mistake surfaces immediately as a failed deploy, not a silent runtime failure.

| Secret | What it protects | Rotation impact |
|---|---|---|
| `JWT_SECRET` | Access token signing | **Rotating this invalidates every currently-issued access token immediately** — every logged-in user is signed out at their next request. This is the correct, intended behavior for a genuine compromise; for routine rotation, schedule it for a low-traffic window and communicate it. |
| `JWT_REFRESH_SECRET` | Refresh token signing | Same effect as `JWT_SECRET` but for refresh tokens — rotating it means every user must log in again from scratch (a rotated access-only secret would let them refresh through; rotating both forces a real re-login). |
| `DATABASE_URL` (password component) | Database access | Rotate the password at the database side first (or use a provider's credential-rotation feature), then update `DATABASE_URL` and redeploy — never the reverse order, or the app loses connectivity before the new credential exists. |
| `BACKUP_ENCRYPTION_KEY` | AES-256-GCM encryption of backup artifacts | **Rotating this does NOT re-encrypt existing backups.** Every `BackupRun` encrypted under the old key needs the OLD key to ever be restored — keep the old key retained and documented (e.g., in a secrets manager's version history) for at least as long as `BACKUP_RETENTION_DAYS`, or those backups become permanently unrestorable. New backups after rotation use the new key automatically. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Off-site backup upload | Rotate at the cloud provider first (create a new key, confirm it works, then revoke the old one) — never revoke the old key before confirming the new one is live, or backups silently stop uploading (`BLOCKED — CREDENTIAL` in this environment as of Phase 33/34; this row applies once a real credential is provisioned). |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Payment processing / webhook signature verification | Rotate in the Stripe Dashboard, confirm the new webhook secret matches the specific configured endpoint (each endpoint has its own secret — see `PAYMENT_INCIDENT_RUNBOOK.md`), then update and redeploy. `BLOCKED — CREDENTIAL` in this environment as of Phase 33/34. |
| `OPENAI_API_KEY` | AI provider access | Rotate in the OpenAI dashboard, update, redeploy. `BLOCKED — CREDENTIAL` in this environment as of Phase 33/34. |
| `ALERT_WEBHOOK_URL` | Alert delivery destination | May itself embed a secret token (many webhook URLs do) — treat the whole URL as sensitive, not just the other secrets above. |

## Routine rotation procedure (no suspected compromise)

1. Generate the new credential at its source (a real random value via `openssl rand -base64 48` for JWT secrets; the provider's own key-creation flow for Stripe/OpenAI/S3).
2. Update the deploying environment's secret store (never commit a real secret to git — confirmed clean via Phase 33's git-history scan; keep it that way).
3. Redeploy following `DEPLOYMENT_RUNBOOK.md`.
4. Confirm the app boots cleanly (env validation would have rejected a malformed value at this step) and a real smoke test passes.
5. Only after confirming the new credential works, revoke/delete the old one at its source — never revoke-then-verify.

## Emergency rotation (suspected compromise)

Follow `SECURITY_INCIDENT_RUNBOOK.md`'s "if a credential is suspected compromised" step first (immediate rotation, treat old-signed sessions as invalid) — this document is the reference for HOW to rotate each specific secret; that one is the reference for WHEN and the surrounding incident process.
