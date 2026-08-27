# Phase 30 — Security Certification (Tracks A & B)

**Status discipline (unchanged from every prior phase):** `VERIFIED` (real execution observed), `BLOCKED — ENVIRONMENT`, `BLOCKED — CREDENTIAL`, `NOT ATTEMPTED`. Never marked `VERIFIED` from reading code alone.

This document covers Track A (Production Configuration Hardening) and Track B (Production Security Hardening). See `docs/PHASE_30_ENVIRONMENT_CONFIG_AUDIT.md` for Track A's full detail — summarized here alongside Track B for one consolidated security record.

---

## Track A summary (full detail in the environment-config-audit doc)

| Gate | Status |
|---|---|
| `ENV_CONFIG_AUDIT` | VERIFIED — 28/28 tests (9 new this phase, closing a real zero-coverage gap in the Stripe production/test-key guards) |
| `CONFIG_CONTRACT` | VERIFIED (pre-existing, confirmed holding) |
| `SECRET_LEAKAGE_CERTIFICATION` | VERIFIED, with `DOCKER_IMAGE_LAYER_INSPECTION` sub-check `BLOCKED — ENVIRONMENT` (no Docker daemon this session) |

## Track B.4 — Authentication hardening

Real, working refresh-token rotation and session-revocation logic (`auth.service.ts`) existed with **zero test coverage** before this phase — nothing proved a used refresh token could not be replayed, or that logout actually terminated a session.

| Scenario | Result |
|---|---|
| Refresh token reuse after rotation | VERIFIED rejected (401) — the old token is genuinely worthless after one legitimate rotation |
| Logout revokes the session | VERIFIED — the same refresh token is rejected immediately afterward |
| Double logout | VERIFIED idempotent (204 both times, never a 500) |
| Cryptographically forged access token (wrong signing key) | VERIFIED rejected (401) |
| Same-secret-signed but claim-tampered token | VERIFIED — documents the real trust boundary: signature integrity, not claim content, is what a client can never forge without the real `JWT_SECRET` |
| Demoted OWNER's already-issued token | VERIFIED to keep stale permissions until next refresh — a real, bounded (≤`JWT_EXPIRES_IN`, default 15 min) staleness window, explicitly tested and documented rather than silently assumed away. A refreshed token immediately reflects the real, current role. |

**`AUTHENTICATION_HARDENING = VERIFIED`** — 6/6 new tests (`phase30-auth-hardening.integration.test.ts`).

## Track B.5 — Full authorization matrix

Built from this codebase's **real** permission catalog (`seed-rbac.ts`: 7 permissions × 6 roles — OWNER/ADMIN/MANAGER/MEMBER/VIEWER/GUEST), not the phase's own illustrative 4-role example, which doesn't match this system's actual RBAC model or its separate, orthogonal `isSystemAdmin` platform flag.

| Permission | OWNER | ADMIN | MANAGER | MEMBER | VIEWER | GUEST |
|---|---|---|---|---|---|---|
| `workspace.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `billing.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `business_profile.manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `contact.manage` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `lead.manage` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `workflow.execute` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `workflow.approve` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

Every cell above was verified via a real HTTP request against the real endpoint that gates that permission — not asserted from the role-definition source file. Plus:

- **Admin panel orthogonality**: VERIFIED — a real OWNER (every workspace permission) gets 403 on `/admin/dashboard`; a real `isSystemAdmin` user with **zero** workspace memberships gets 200. The two systems do not overlap.
- **Anonymous rejection**: VERIFIED — every gated route tested rejects a request with no `Authorization` header at all with 401, before any permission or resource check.

**`AUTHORIZATION_MATRIX = VERIFIED`** — 9/9 new tests (`phase30-authorization-matrix.integration.test.ts`).

## Track B.6 — Abuse protection

Audited existing coverage (`abuse-protection.integration.test.ts`, `marketing-autopilot-rate-limit.integration.test.ts`, `marketing-autopilot-input-validation.integration.test.ts`) first — login/register/invitation bursts, oversized bodies, malformed JSON, workflow-execution spam, and unexpected extra fields were already real-tested. Two genuine, previously-untested surfaces found and closed:

| Scenario | Result |
|---|---|
| Feedback spam (real `feedbackRateLimit`, Phase 29) | VERIFIED — the first 20 requests within the real hourly limit all succeed (201), the tail is genuinely rejected (429) |
| Pagination: absurd limit (999999999) | VERIFIED rejected (422) — `listContactsQuerySchema`'s real `max(100)` Zod bound holds |
| Pagination: negative limit | VERIFIED rejected (422) |
| Pagination: zero limit | VERIFIED rejected (422) |
| Pagination: non-numeric limit | VERIFIED rejected (422), no raw coercion crash |
| Pagination: malformed (non-UUID) cursor | VERIFIED rejected (422), never used as a raw, unvalidated lookup key |

**`ABUSE_PROTECTION = VERIFIED`** — 6/6 new tests (`phase30-abuse-protection.integration.test.ts`) plus the pre-existing 5 confirmed still passing.

---

## Track B gate matrix

| Gate | Status |
|---|---|
| `AUTHENTICATION_HARDENING` | VERIFIED |
| `AUTHORIZATION_MATRIX` | VERIFIED |
| `ABUSE_PROTECTION` | VERIFIED |

**Tracks A & B combined: 8 real gates, all VERIFIED except one honestly `BLOCKED — ENVIRONMENT` sub-check (Docker image layer inspection). 0 FAILED, 0 fabricated.**
