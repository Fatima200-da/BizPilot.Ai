# BizPilot AI — Design System: Foundations

Covers: color, typography, spacing, elevation, borders/radius, icons, and motion. For component-level specs see [components.md](components.md); for the Tailwind theme, naming, and folder structure see [conventions.md](conventions.md).

**Reference implementation:** `frontend/src/styles/theme.css` (tokens), `frontend/src/styles/base.css` (global resets).

## Design principles

1. **Restraint over decoration.** Borders and typography do the work; shadows and color are used sparingly and with intent (Linear/Stripe, not Material).
2. **Two-layer surfaces.** A muted `background` (canvas) and a brighter `surface` (cards, panels) create depth without shadows. Never place a `surface` element directly on `surface` of the same elevation — nest with a border, not another shadow.
3. **Tokens, not values.** Components never hardcode a hex color, a pixel radius, or an arbitrary shadow. Every visual property traces back to a token in `theme.css`. This is what makes the dark theme "free" and rebrand-able.
4. **Every interactive element is keyboard-operable and has a visible focus ring** (WCAG 2.4.7, 2.1.1). This isn't optional per-component — it's built into the base primitives (see `:focus-visible` in `base.css`).

---

## 1. Color

### Token architecture

Two layers, both defined in `theme.css`:

| Layer | Example | Rule |
|---|---|---|
| **Primitive** | `--color-brand-500`, `--color-neutral-800` | Raw scale values. Never consumed directly by components except for charts, gradients, and marketing surfaces. |
| **Semantic** | `--color-primary`, `--color-surface`, `--color-danger-foreground` | The only layer components use. Re-declared per theme (`:root` = light, `.dark` = dark) so the same class (`bg-surface`) resolves differently per theme with **zero `dark:` prefixes in component code**. |

This is why every component in `shared/components/` is theme-agnostic — `Button`, `Card`, `Alert`, etc. contain no `dark:` variants at all. Theming is a CSS-variable swap, not a component concern.

### Primitive scales

**Neutral (slate)** — UI chrome, text, borders:

`50` `#f8fafc` · `100` `#f1f5f9` · `200` `#e2e8f0` · `300` `#cbd5e1` · `400` `#94a3b8` · `500` `#64748b` · `600` `#475569` · `700` `#334155` · `800` `#1e293b` · `900` `#0f172a` · `950` `#020617`

**Brand (indigo)** — primary actions, links, focus rings, active states:

`50` `#eef2ff` · `100` `#e0e7ff` · `200` `#c7d2fe` · `300` `#a5b4fc` · `400` `#818cf8` · `500` `#6366f1` · `600` `#4f46e5` · `700` `#4338ca` · `800` `#3730a3` · `900` `#312e81` · `950` `#1e1b4b`

**Accent (violet)** — reserved for AI-specific moments: generation states, gradients, "powered by AI" highlights. Not used for standard UI chrome, so it stays meaningful when it appears. `400` `#a78bfa` · `500` `#8b5cf6` · `600` `#7c3aed`.

**Semantic scales** (success/warning/danger/info) each expose `50/200/300/400/600/700` — enough to build the light-mode "50 surface + 700 text" pairing and the dark-mode "400 text on 12%-opacity surface" pairing described below.

### Semantic tokens

| Token | Light | Dark | Used for |
|---|---|---|---|
| `background` | `neutral-50` | `neutral-950` | Page canvas |
| `surface` | `#fff` | `neutral-900` | Cards, modals, dropdowns, table rows |
| `surface-secondary` | `neutral-100` | `#0b1120` | Table headers, subtle section fills |
| `surface-hover` | `neutral-100` | `neutral-800` | Hover state for rows/menu items |
| `foreground` | `neutral-900` | `neutral-50` | Primary text |
| `muted-foreground` | `neutral-500` | `neutral-400` | Secondary/helper text |
| `border` / `border-strong` | `neutral-200` / `300` | `neutral-800` / `700` | Hairline dividers / emphasized borders (input outlines) |
| `primary` / `primary-hover` | `brand-600` / `700` | `brand-500` / `400` | Primary buttons, links, active nav |
| `ring` | `brand-500` | `brand-400` | Focus ring color |
| `destructive` | `danger-600` | `danger-400` | Destructive buttons |

Full token list: `theme.css` → `:root` / `.dark` blocks.

### Semantic status color formula

Success/warning/danger/info follow one formula everywhere (badges, alerts, toasts) so they're predictable:

- **Light:** surface = `{color}-50`, foreground text = `{color}-700`, border = `{color}-200`, icon/accent = `{color}-600`.
- **Dark:** surface = `{color}-500` at 12% opacity, foreground text = `{color}-300`, border = `{color}-500` at 30% opacity, icon/accent = `{color}-400`.

Both pairings meet WCAG AA (4.5:1) for normal text against their surface.

### Usage rules

- Text on `surface`/`background`: use `foreground` or `muted-foreground` only. Never place `foreground` text on a raw primitive color without checking contrast.
- `primary` is the only color allowed for the single most-important action on a screen. Competing primary buttons on one view is a bug, not a style choice.
- `accent` (violet) is reserved for AI-generation affordances — do not reach for it as a second brand color.
- Charts/data-viz may use primitive scales directly (documented separately when the charting library is chosen); UI chrome may not.

---

## 2. Typography

**Typeface:** Inter (variable), self-hosted via `@fontsource-variable/inter` — no external font request, no FOUT/FOIT race. Monospace fallback (`--font-mono`) is reserved for code/API keys/numeric IDs.

| Token | Size | Line height | Tracking | Role |
|---|---|---|---|---|
| `text-xs` | 12px | 16px | +0.01em | Captions, table meta, timestamps |
| `text-sm` | 13px | 20px | 0 | Secondary UI text, form helper text, dense tables |
| `text-base` | 15px | 24px | 0 | **Default body / UI text** |
| `text-lg` | 17px | 26px | −0.01em | Card titles, emphasized body |
| `text-xl` | 20px | 28px | −0.01em | Section headings (H4) |
| `text-2xl` | 24px | 32px | −0.015em | Page headings (H3) |
| `text-3xl` | 30px | 36px | −0.02em | Panel/modal headings (H2) |
| `text-4xl` | 38px | 44px | −0.02em | Page-level H1 |
| `text-5xl` | 48px | 56px | −0.025em | Marketing/hero only |

Notes:
- App UI defaults to **15px**, not the browser default 16px — this matches the density of Linear/Stripe dashboards while staying above the 12px accessibility floor. Marketing pages may use a 16px body scale; that's a page-level decision, not a token change.
- Weights: `font-medium` (500) for UI labels/buttons, `font-semibold` (600) for headings, `font-normal` (400) for body copy. Avoid `font-bold` (700) — Inter at 700 reads heavier than this system's restrained aesthetic wants; use `font-semibold` even for H1.
- Tracking tightens as size increases (standard optical correction) — already baked into each token, never set manually.

---

## 3. Spacing

**Base unit: 8px**, using Tailwind's default 4px spacing scale (`--spacing: 0.25rem`) so every *even* step (`2, 4, 6, 8...` → 8/16/24/32px) lands on the 8px grid, and odd steps (`1, 3, 5...` → 4/12/20px) give a 4px half-step for icon-to-label gaps, input padding, and other tight spots where 8px is too coarse.

| Step | px | Typical use |
|---|---|---|
| `1` | 4px | Icon-to-text gap, badge internal padding |
| `2` | 8px | Tight stacks, chip padding |
| `3` | 12px | Input horizontal padding (sm) |
| `4` | 16px | Default gap between related controls, card internal padding (sm) |
| `6` | 24px | Card padding (default), section internal spacing |
| `8` | 32px | Gap between unrelated sections |
| `12`–`16` | 48–64px | Page-level vertical rhythm, empty-state padding |

Rule of thumb: **use even steps by default; drop to an odd step only for optical/icon alignment**, never for macro layout.

---

## 4. Shadows (elevation)

Shadows are soft, low-opacity, and layered (never a single hard drop-shadow) — borders carry most of the separation, shadows only add depth for genuinely floating elements.

| Token | Use |
|---|---|
| `shadow-xs` | Inputs, buttons at rest (barely perceptible) |
| `shadow-sm` | Cards, table container |
| `shadow-md` | Hover-elevated cards, popovers |
| `shadow-lg` | Dropdown/select menus |
| `shadow-xl` | Modals |
| `shadow-glow` | Primary CTA emphasis / AI-active state only — used sparingly |

**Dark mode:** shadows are re-declared with black instead of slate and roughly 4–6× the opacity, because a light-mode shadow is invisible on a dark surface. This is automatic — never apply a manual `dark:shadow-*` override.

---

## 5. Borders & radius

- **Hairline borders (1px)** are the primary separator, not shadows. The global reset (`* { border-color: var(--color-border) }` in `base.css`) means any element can add `border` and get the correct themed color for free.
- **Radius scale**, default is **16px** (`rounded-xl`) per the system spec:

| Token | px | Use |
|---|---|---|
| `radius-sm` | 6px | Checkboxes, small chips |
| `radius-md` | 10px | Inputs, buttons, small controls |
| `radius-lg` | 12px | Compact cards, list rows |
| `radius-xl` | **16px** | **Default** — cards, modals, popovers, dropdowns |
| `radius-2xl` | 20px | Hero/marketing panels |
| `radius-full` | 9999px | Avatars, pills, badges, dots |

Rule: controls a user clicks/types into (`Button`, `Input`, `Select`) use `radius-md`; containers that hold content (`Card`, `Modal`, `Dropdown`) use `radius-xl`. Don't mix — a card with `radius-md` or a button with `radius-xl` both read as off-brand.

---

## 6. Icons

**Library:** Lucide React exclusively — no mixing icon sets (inconsistent stroke weights are one of the fastest ways to make a UI look cheap).

- **Sizes:** 16px (`size-4`) inline with `text-sm`/`text-base` UI text; 20px (`size-5`) for nav/sidebar items and standalone icon buttons; 24px (`size-6`) for empty-state/illustrative use only.
- **Stroke width:** default (`1.5`–`2`, Lucide's default) everywhere. Don't override per-icon — a mixed-weight icon set is as damaging as a mixed icon library.
- **Color:** icons inherit `currentColor` and take on the surrounding text color — never hardcode an icon fill/stroke color outside the semantic-status formula (§1).
- **Alignment:** icons sit in a flex row with `gap-2` (8px) from adjacent text, sized to align optically with the text's cap-height, not its full line-height — verify at `size-4`/`text-sm` and `size-5`/`text-base` pairings before introducing a new combination.
- **Accessibility:** decorative icons get `aria-hidden="true"` (every icon usage in the primitives already does this). An icon that is the *only* content of a control (icon-only button) must carry an `aria-label` on the control itself.

---

## 21. Animation guidelines

**Two motion systems, chosen by what's animating — not by preference:**

1. **CSS keyframes (`--animate-*` tokens in `theme.css`)** drive **Radix-owned overlays** (`Modal`, `Dropdown`, `Select`, `Toast`). Radix's `Content` primitives detect the `animationend` event and hold the node mounted until the exit animation finishes, so plain CSS is sufficient and avoids wiring every overlay through `AnimatePresence`/`forceMount`.
2. **Framer Motion** drives everything **not owned by Radix's mount lifecycle**: the mobile `Sidebar` drawer, collapsible nav groups, list stagger/reordering, hover/tap micro-interactions, and any bespoke page-level transition.

### Timing scale

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--animate-fade-*` | 150ms / 120ms | `cubic-bezier(0.16,1,0.3,1)` in, `ease-in` out | Overlay backdrops |
| `--animate-scale-*` | 150ms / 100ms | same | Dropdown/select/modal content |
| `--animate-slide-in-{top,bottom,right}` | 200–250ms | `cubic-bezier(0.16,1,0.3,1)` | Directional entrances (toast, drawer) |
| Micro-interactions (hover/tap) | 100–150ms | `ease-out` | Button/card hover, active scale |
| Layout/list stagger | 180–220ms per item, ~30ms stagger | `cubic-bezier(0.16,1,0.3,1)` | Collapsible groups, list reveals |

`cubic-bezier(0.16, 1, 0.3, 1)` ("expo-out") is the system's signature easing for entrances — it's what gives Linear/Vercel-style UI its snappy-but-soft feel. Exits are always faster and linear/ease-in (200ms in, ~100ms out is the right ratio — never symmetric).

### Rules

- **Respect `prefers-reduced-motion`.** Handled globally in `base.css` (all animations/transitions collapse to ~0). Don't add a component-level escape hatch that bypasses this.
- **Animate `transform`/`opacity` only.** Never animate `width`/`height`/`top`/`left` directly (causes layout thrash) — the one exception is the collapsible nav group, which animates `height: auto` via Framer Motion's layout measurement, not raw CSS.
- **Loading states use `Skeleton`'s shimmer**, not a spinner, whenever content shape is known ahead of time (cards, tables, lists). Reserve `Spinner` for buttons and unknown-duration/unknown-shape operations.
- Motion should never be the only signal for a state change — always pair with a color/icon/text change (WCAG 1.4.1-adjacent good practice, and it keeps the UI legible for `prefers-reduced-motion` users who get none of the motion).
