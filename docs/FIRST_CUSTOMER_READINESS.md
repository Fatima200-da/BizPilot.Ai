# First-Customer Readiness

**Persona**: an Azerbaijani small-business owner (e.g. a beauty salon) who is not a developer, using a real browser, with no help from the founder except a link and a password.

This document is the output of actually walking through that persona's journey in a real Chromium browser across Phases 18 and 19 — not a simulated or inferred walkthrough. Every friction point below was directly observed; three of them were severe enough to stop the persona completely and were fixed in Phase 18 (see `docs/PHASE_18_PRODUCTION_LAUNCH_VALIDATION.md`). **Phase 19 update**: Friction Point 2 (resume my existing plan) — the top-priority open item from Phase 18 — is now fixed and re-verified live in a real browser; see `docs/PHASE_19_PRODUCTION_OPERATIONS_AND_RELEASE.md`.

## The walkthrough, as performed

1. Open the app → land on `/register` (no marketing/landing page exists yet — see Friction Point 1).
2. Register with name, email, password → immediately land on onboarding, no email verification step.
3. Name the workspace ("Günel Beauty Studio") → continue.
4. Describe the business (name, industry, target audience, content language) → continue → land directly on the Marketing Autopilot page, already inside the app shell.
5. Select the just-created business profile from a dropdown → pick an objective → pick platforms → click "Strategiya yarat."
6. Within roughly a second, a full 30-day content calendar appears: strategy summary, then 30 individual day-cards with topic, platform, content type, caption, and visual direction.
7. Edit one caption, click "Təsdiqlə" (approve) on that card → status badge updates to "Təsdiqlənib."
8. Click "Planı təsdiqlə" (approve the whole plan) → **the entire app went blank.** (Bug #1 — fixed this phase.)
9. After the fix: a success message appears ("Plan tamamlandı").
10. Navigate to the Dashboard via the sidebar → **the entire app went blank again**, this time on every load, for every user, always. (Bug #2 — fixed this phase.)
11. After the fix: Dashboard shows the business profile and two clear next-action cards (Marketing Autopilot, CRM).
12. Log out → land on `/login`.
13. Log back in with the same credentials → **forced through onboarding again, as if the account were brand new.** (Bug #3 — fixed this phase.)
14. After the fix: login correctly resolves the existing workspace and lands directly on the Dashboard, with "Günel Beauty Studio" still there.
15. Test a mistyped password → **no error message appeared; the page just silently reloaded.** (Bug #4 — fixed this phase.)
16. After the fix: a clear (if English-language — see Friction Point 6) error message appears.
17. Navigate back to Marketing Autopilot to check on the approved plan → **Phase 19**: the existing 30-day calendar now appears directly, with an explicit "Yeni plan yarat" (start a new plan) button available as an escape hatch. (Friction Point 2 — fixed in Phase 19, re-verified live in a real browser via Playwright.)

## Friction Points

| # | Friction Point | Severity | Current Behavior | Recommended Fix | Blocks Onboarding? |
|---|---|---|---|---|---|
| 1 | No landing/marketing page — `/` for an unauthenticated visitor redirects straight to `/register`. A real prospect has no way to learn what BizPilot.Ai does before being asked to create an account. | Medium | Immediate redirect to the register form. | A minimal public landing page explaining the product, with a clear "Get Started" CTA into `/register`. | No — the persona can still complete signup — but it is a real trust/conversion gap for anyone arriving cold. |
| 2 | No "resume my existing plan" view. | **Fixed in Phase 19** | `GET /workflow-instances/latest` + frontend resume logic; verified live via Playwright (`e2e/golden-path.spec.ts`, "resumes the existing approved plan"). | Already applied — see CHANGELOG. | Was not a hard onboarding blocker, but directly undermined "return later, find your saved work" — now closed. |
| 3 | Dashboard crashed to a completely blank page for every single user, on every load. | **Critical** | **Fixed this phase** (`Button asChild` / Radix `Slot` composition bug). | Already applied — see CHANGELOG. | Would have blocked 100% of users, 100% of the time, before this phase's fix. |
| 4 | Approving the generated content plan crashed the entire app. | **Critical** | **Fixed this phase** (approve-response missing relations the frontend depended on). | Already applied — see CHANGELOG. | Would have blocked every user at the exact moment they tried to finish the core workflow. |
| 5 | Logging back in after logging out forced the user through onboarding again, as if starting fresh. | **Critical** | **Fixed this phase** (no workspace-resolution mechanism existed for returning logins). | Already applied — see CHANGELOG. | Would have made the product unusable for anyone who ever closed their browser. |
| 6 | Backend error messages (e.g. "Email or password is incorrect.") are hardcoded in English, while 100% of the rest of the UI is Azerbaijani. | Medium | A real Azerbaijani-speaking user sees a jarring, untranslated error string at exactly the moment something has already gone wrong for them. | Move user-facing error copy into the same i18n mechanism the rest of the frontend presumably uses (or, at minimum, translate the small set of `AppError` subclass messages), rather than hardcoding English in `backend/src/common/errors/app-error.ts`. | No, but it's a real, jarring inconsistency for the target market this product is explicitly built for. |
| 7 | No password-strength or confirmation field on registration beyond a minimum-length check; no "forgot password" flow exists anywhere in the UI. | Medium | A locked-out user (forgotten password) has no self-service recovery path at all. | Out of scope to build this phase (not attempted — flagging only). A real "forgot password" flow is a hard prerequisite for any real customer beyond the founder's own supervised testing. | Not for the first session, but yes for any customer who returns weeks later and has forgotten their password. |
| 8 | A mistyped password produced a silent full-page reload instead of any visible error. | High | **Fixed this phase** (the global 401-response interceptor was treating login failures as session expiry). | Already applied — see CHANGELOG. | Would have looked like the app was simply broken, with no explanation, to anyone who fat-fingered their password. |

## Priorities

Phase 18 fixed the three **Critical** items (3, 4, 5) and the **High** item (8) because they were confirmed, 100%-reproducible, and directly on the path a first customer would take within their first five minutes. Phase 19 fixed Friction Point 2 (resume my plan), the highest-value remaining item. Remaining, in order of value-to-effort:

1. **Friction Point 6** (English error strings) — small, mechanical, but directly undermines the product's Azerbaijan-first positioning.
2. **Friction Point 1** (landing page) — needed before any real marketing/acquisition effort, not needed for a founder-supervised first customer.
3. **Friction Point 7** (forgot password) — needed before the founder can stop being the account-recovery mechanism, i.e. needed before real scale, not before the very first customer.

## Bottom line

A real first customer would previously have been stopped completely — either immediately (Dashboard crash), at the exact moment they tried to approve their first generated content plan, the first time they tried to log back in, or when trying to find a plan they'd already made. All four are now fixed (three in Phase 18, the fourth in Phase 19). What remains (translated errors, landing page, password recovery) are real but genuinely non-blocking gaps for a founder-supervised first customer, and are prioritized above rather than silently deferred.
