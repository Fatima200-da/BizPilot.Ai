# Security Incident Runbook

**Audience:** whoever operates BizPilot.Ai in production. **Scope:** suspected unauthorized access, credential compromise, session abuse, or any real security finding. Read [`INCIDENT_RESPONSE_RUNBOOK.md`](INCIDENT_RESPONSE_RUNBOOK.md) first for severity/escalation basics — this document is the security-specific detail underneath it.

## Real security controls already in place (what you're relying on)

- **Session model**: every session (`Session` table) has a `tokenHash` (never the raw refresh token, stored hashed), `expiresAt`, and `revokedAt` — a session is valid only if unexpired AND unrevoked. `userAgent`/`ipAddress` are recorded per session for real forensic value.
- **JWT algorithm pinning** (`backend/src/modules/auth/jwt.ts`): both signing (`signAccessToken`/`signRefreshToken`) and verification (`decodeUnknown`) explicitly pin `algorithms: ['HS256']` — an attacker cannot force a `none`-algorithm or alg-confusion forgery. Verified by `phase33-jwt-algorithm-pinning.integration.test.ts`.
- **Password change / reset** (`backend/src/modules/auth/auth.service.ts`, Phase 33): `changePassword` requires the real current password (bcrypt-verified) and revokes ALL of the user's sessions on success (not just the current one — the access-token payload carries no `sessionId` to selectively exclude, so full revocation is the correct, deliberate behavior). `resetPassword` consumes a real single-use, time-limited (1 hour), sha256-hashed token via an atomic, race-safe DB transaction (`updateMany` with a `usedAt: null` guard — a replayed/raced token is provably rejected, not just discouraged) and also revokes all sessions on success.
- **Anti-enumeration**: `requestPasswordReset` always returns `204` and creates a token ONLY for a real, existing, non-deleted account — an attacker cannot use it to discover which emails are registered.
- **Rate limiting**: `authRateLimit` (20 requests / 15 min / IP) is shared across `/auth/register`, `/login`, `/refresh`, `/change-password`, `/forgot-password`, `/reset-password` — genuinely tested to trigger a real `429` (see `phase33-password-security.integration.test.ts`'s dedicated abuse-probe test).
- **IDOR protections**: every tenant-scoped resource (workspaces, backups, retention, data exports, and all core business resources) is queried with an explicit `workspaceId`/ownership filter, never by ID alone — verified via real cross-tenant access-denial tests across every phase, most recently `phase33-background-export.integration.test.ts`'s workspace-B-cannot-see-workspace-A's-export-runs test.
- **Audit trail**: every data-retention purge, every meaningful admin/workspace action writes a real `AuditLog` row (`actorUserId`, `action`, `entityType`, `entityId`, `previousValue`/`newValue`) — this is your primary forensic source during a security incident, query it directly, don't rely on memory of what happened.
- **Security headers / CORS**: configured in `backend/src/app.ts` (helmet + explicit CORS origin allowlist). Re-verify the real, current configuration in that file directly before relying on this description — it is code, not policy, and can drift.

## Immediate steps for a suspected compromise

1. **Do not panic-delete data or accounts** — that destroys forensic evidence you will want later. Revoking access is reversible; deleting evidence is not.
2. **Identify the real scope**: query `sessions` for the affected user(s) (`SELECT * FROM sessions WHERE "userId" = '<id>' AND "revokedAt" IS NULL;`), and `audit_logs` for recent activity by that actor (`SELECT * FROM audit_logs WHERE "actorUserId" = '<id>' ORDER BY "createdAt" DESC LIMIT 100;`).
3. **Revoke sessions immediately** for any confirmed-compromised account:
   ```sql
   UPDATE sessions SET "revokedAt" = now() WHERE "userId" = '<id>' AND "revokedAt" IS NULL;
   ```
   This is the same effect `changePassword()` produces internally — safe, reversible in the sense that the legitimate user simply logs in again.
4. **If a credential (JWT secret, DB password, S3 key, Stripe key, encryption key) is suspected compromised**: rotate it immediately in the real secret store, redeploy, and treat every session/token signed with the OLD secret as invalid going forward (JWT secret rotation invalidates all outstanding tokens at once — this is the correct, intended behavior, not a bug to work around).
5. **Classify severity** per `INCIDENT_RESPONSE_RUNBOOK.md` — a single confirmed account takeover with no further lateral movement is typically SEV2; confirmed broad unauthorized data access is SEV1.

## Secret inventory (for audit / rotation planning)

Real secrets this system depends on, and where they're validated (`backend/src/config/env.ts`): `JWT_SECRET` (access+refresh signing), `DATABASE_URL`, `BACKUP_ENCRYPTION_KEY` (AES-256-GCM for backup artifacts), `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (off-site backup upload — currently unset, `BLOCKED — CREDENTIAL`), `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (currently unset, `BLOCKED — CREDENTIAL`), `OPENAI_API_KEY` (currently unset, `BLOCKED — CREDENTIAL`). Every one of these is validated at startup by a real Zod schema with conditional requirements (e.g. `STRIPE_SECRET_KEY` is required and format-checked ONLY when `PAYMENT_PROVIDER=stripe`) — the app will refuse to boot with a malformed or missing required secret rather than silently degrading. Confirmed via direct inspection this phase that no genuine secret value is committed to git history or present in the built frontend bundle (`git log --all -p` and a post-build `grep` of `dist/assets/*.js`, both zero matches).

## After a security incident

Follow `INCIDENT_RESPONSE_RUNBOOK.md`'s postmortem requirement. Additionally: confirm the specific vulnerability or gap that enabled the incident (if any) has a real regression test added, not just a manual fix — this codebase's own discipline (see the IDOR audit tests, JWT pinning tests) is to prove a class of attack is closed, not just patch the one instance found.
