# BizPilot AI Design System

A premium, accessible design system built on React 19, TypeScript, Tailwind CSS v4, Radix UI, Framer Motion, and Lucide React — targeting the interface quality bar of Linear, Stripe, Notion, Vercel, and OpenAI.

| Doc | Covers |
|---|---|
| [foundations.md](foundations.md) | Color, typography, spacing, shadows, borders/radius, icons, animation guidelines |
| [components.md](components.md) | Every reusable component: buttons, form controls, cards, tables, badges, alerts, modals, dropdowns, sidebar, top nav, dashboard layout, skeletons, empty states, toasts |
| [conventions.md](conventions.md) | Tailwind theme architecture, component naming rules, folder structure |

## Implementation

- **Tokens:** `frontend/src/styles/theme.css` (colors, type, radius, shadow, motion — light + dark) and `base.css` (global resets).
- **Components:** `frontend/src/shared/components/{ui,feedback,overlay,layout}/`.
- **Utilities:** `frontend/src/shared/lib/cn.ts`, `frontend/src/shared/hooks/useTheme.ts`.

## Status

This is the design system layer only — no application pages, routing, or business logic. Every primitive is verified to typecheck (`tsc -b --noEmit`), lint clean (`eslint .`), and build (`vite build`) as of this writing. Next: `app/providers` + `app/router` (application shell) and the first feature pages consuming these primitives.
