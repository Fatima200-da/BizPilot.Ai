# BizPilot AI — Design System: Conventions

Covers: the Tailwind theme configuration, component naming conventions, and the UI folder structure. See [foundations.md](foundations.md) for tokens and [components.md](components.md) for component specs.

---

## 22. Tailwind theme configuration

Tailwind v4 is **CSS-first** — there is no `theme.extend` object to maintain. The theme lives in `frontend/src/styles/theme.css` and is imported once from `frontend/src/styles/index.css`:

```css
/* frontend/src/styles/index.css */
@import 'tailwindcss';
@import '@fontsource-variable/inter';

@import './theme.css';   /* design tokens: colors, type, radius, shadow, motion */
@import './base.css';    /* global resets: focus, scrollbar, selection */
```

`frontend/tailwind.config.ts` is intentionally minimal — just `content` globs for class-scanning. It is **not** where design tokens live; don't add a `theme.extend.colors` object there. If you need a JS-side reference to a token value (e.g. for a canvas/chart library that can't read CSS variables), read `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` at call time rather than duplicating the value in the config.

### How theme.css is organized

```
@custom-variant dark (&:where(.dark, .dark *));   /* class-based dark mode toggle */

@theme {
  --font-*      /* Inter + mono, full type scale (size/line-height/tracking per step) */
  --text-*
  --radius-*    /* 6/10/12/16/20px + full — 16px (`xl`) is the system default */
  --shadow-*    /* elevation scale, redeclared for dark further down */
  --animate-*   /* keyframe-backed motion tokens for Radix overlays */
  --color-neutral-*, --color-brand-*, --color-accent-*, --color-{success,warning,danger,info}-*
                /* primitives */
  --color-background, --color-surface, --color-primary, ...
                /* semantic tokens, each `var(--x)` — indirection is intentional (see below) */
}

:root { --background: ...; --primary: ...; /* light values */ }
.dark { --background: ...; --primary: ...; /* dark values */ }
.dark { --shadow-*: ...; /* shadows re-declared separately: still light in :root */ }

@keyframes fade-in { ... } /* etc. — referenced by the --animate-* tokens above */
```

**Why semantic tokens are declared as `--color-x: var(--x)` instead of a value directly:** Tailwind's `@theme` block is what generates utility classes (`bg-primary`, `text-foreground`, ...), but its values are captured at build time into the compiled CSS as fixed custom-property *references*. By making each `@theme` entry point at a *plain* CSS variable (`--primary`, not `--color-brand-600` directly), and re-declaring that plain variable per theme in `:root`/`.dark`, the generated utility class stays a single `var(--primary)` reference that resolves differently depending on which theme class is active on `<html>` — no `dark:` variant needed anywhere in component code.

### Extending the theme

- **New semantic token:** add the `--token: var(--token)` line inside `@theme`, then set `--token` in both `:root` and `.dark`. Never add a token to only one theme — it'll silently fall back to `inherit`/unset in the other.
- **New primitive color:** add the scale to the primitives section of `@theme`. Don't wire it into `:root`/`.dark` unless it also needs a theme-reactive semantic alias.
- **New component-specific one-off value:** first check if an existing token fits. If genuinely one-off (a chart's exact px width, say), it belongs in the component file as an arbitrary Tailwind value (`w-[212px]`), not a new global token — tokens are for values reused across ≥2 components.

---

## 23. Component naming conventions

- **Files:** one component (or one tightly-coupled compound family, e.g. `Card` + `CardHeader` + ...) per file, `PascalCase.tsx` matching the primary export — `Button.tsx` exports `Button`. Non-component utilities are `camelCase.ts` (`cn.ts`, `useTheme.ts`).
- **Compound components:** exported as sibling named exports sharing a prefix, not dot-notation (`CardHeader`, not `Card.Header`) — this keeps every part individually tree-shakeable and gives it its own named import/type. Applies to `Card*`, `Table*`, `Modal*`, `Select*`, `Dropdown*`, `Toast*`.
- **Variant props:** always `variant` (visual style: `primary`/`danger`/...) and `size` (`sm`/`md`/`lg`/...), never bespoke names like `type`/`kind`/`appearance` — every primitive that has variants uses these two prop names so they're guessable without opening the file.
- **Boolean props:** prefixed `is`/`has`/`show`/`hide` for state (`isLoading`, `hasError`) or a bare adjective for a static flag (`disabled`, `required`, `invalid`) matching the equivalent native HTML attribute name where one exists — don't invent `loading` when `isLoading` is the pattern, don't invent `errorState` when `invalid` (matching `aria-invalid`) is.
- **Event handler props:** `onX` (`onDismiss`, `onCollapsedChange`, `onSearchChange`), mirroring the native DOM convention (`onClick`, `onChange`) so controlled/callback props are never ambiguous with native event props.
- **Exported variant functions:** a component styled with `cva` exports its variant function alongside the component (`buttonVariants`, `badgeVariants`, `alertVariants`, `toastVariants`) so a caller can compute the classes without wrapping the component (e.g. applying `Button`'s look to a router `<Link>` via `className={buttonVariants({ variant: 'outline' })}` instead of `asChild`). This does cost a Fast Refresh full-remount on edits to that file in dev — an accepted, standard tradeoff (same pattern as shadcn/ui), not a bug to "fix" by suppressing the ESLint rule.
- **Types:** a component's prop type is named `<Component>Props` and exported (`ButtonProps`, `AvatarProps`). Shared domain-agnostic types (e.g. `NavItem`) live in `shared/types/`, not inline in the component that happens to use them first.

---

## 24. Folder structure

```
frontend/src/
├── app/                        # application shell (providers, router) — added when routing lands
│   ├── providers/
│   └── router/
├── assets/                     # bundled static assets (icons, images, fonts)
├── config/                     # runtime/env configuration
├── features/                   # feature-based vertical slices (see ARCHITECTURE.md)
│   └── <feature>/{api,components,hooks,pages,schemas,types}/
├── shared/
│   ├── components/
│   │   ├── ui/                 # base primitives: Button, Input, Textarea, Select, Checkbox,
│   │   │                       # RadioGroup, Switch, Label, FormHelperText, Avatar, Badge,
│   │   │                       # Card, Table, Spinner
│   │   ├── feedback/           # status/async primitives: Alert, Skeleton, EmptyState, Toast, Toaster
│   │   ├── overlay/             # portal-based floating primitives: Modal, Dropdown
│   │   └── layout/              # app-shell composition: Sidebar, TopNav, DashboardLayout
│   ├── hooks/                  # cross-feature hooks (useTheme, ...)
│   ├── lib/                    # framework-agnostic utilities (cn, ...)
│   ├── types/                  # cross-feature types (NavItem, ...)
│   ├── utils/
│   └── constants/
└── styles/
    ├── index.css                # single entry: Tailwind + font + theme + base imports
    ├── theme.css                 # design tokens (§22)
    └── base.css                  # global element resets
```

### Grouping rule (why four folders under `components/`, not one flat `ui/`)

Each folder is a **dependency layer**, and layers only depend downward:

```
layout/  → overlay/, feedback/, ui/
overlay/ → ui/
feedback/ → ui/
ui/      → (nothing else in components/)
```

`ui/` primitives never import from `feedback/`, `overlay/`, or `layout/`. This is why `Spinner` lives in `ui/` (Button, a `ui/` component, needs it) rather than `feedback/` — putting it there would create a `ui/ → feedback/` back-edge. When adding a new component, place it at the lowest layer that satisfies its own imports, not by category feel.

### Barrel exports

Each of the four component folders has an `index.ts` re-exporting everything in it (`export * from './Button'`, ...). Feature code imports from the folder barrel (`@/shared/components/ui`) for multi-component usage, or the direct file for a single component when bundle-boundary clarity matters. Never add a barrel at `shared/components/index.ts` re-exporting all four sub-barrels — it would collapse the layering the folder split exists to enforce and create accidental cross-layer coupling.

### Where new components go

| Component does this... | Goes in... |
|---|---|
| Renders a single visual primitive, no portal, no Radix `Root`/`Trigger`/`Content` split | `ui/` |
| Communicates async/system status (loading, empty, error, notification) | `feedback/` |
| Renders through a React portal, floats above page layout | `overlay/` |
| Composes multiple lower-layer components into an app-chrome region | `layout/` |
