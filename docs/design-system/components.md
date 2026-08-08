# BizPilot AI — Design System: Components

Specs for every reusable primitive shipped in `frontend/src/shared/components/`. See [foundations.md](foundations.md) for the tokens these components consume, and [conventions.md](conventions.md) for naming/folder rules.

All components are **presentational and data-driven via props** — none fetch data, own business/domain logic, or hardcode routes. Interactive primitives (`Select`, `Checkbox`, `RadioGroup`, `Switch`, `Modal`, `Dropdown`, `Toast`) wrap [Radix UI](https://www.radix-ui.com/) unstyled primitives for correct keyboard navigation, focus management, and ARIA wiring — the design system supplies styling and composition, Radix supplies behavior. Variant styling is generated with `class-variance-authority` (`cva`); class merging goes through `cn()` (`shared/lib/cn.ts`, `clsx` + `tailwind-merge`).

---

## 8. Button

`shared/components/ui/Button.tsx`

**Variants:** `primary` (default) · `secondary` · `outline` · `ghost` · `destructive` · `link`
**Sizes:** `sm` (32px) · `md` (40px, default) · `lg` (48px) · `icon` (40×40px square)

| Prop | Type | Notes |
|---|---|---|
| `variant`, `size` | see above | via `cva`, exported as `buttonVariants` for `asChild`/`Link` reuse |
| `asChild` | `boolean` | Renders styles onto the single child element (Radix `Slot`) — use to make a router `<Link>` look like a button without nesting `<a>` in `<button>` |
| `isLoading` | `boolean` | Shows `Spinner`, sets `aria-busy`, disables the button, **preserves width** |
| `leftIcon` / `rightIcon` | `ReactNode` | Hidden automatically while `isLoading` |

**Accessibility:** disabled/loading state uses the native `disabled` attribute (not just a visual style) so it's excluded from the tab order automatically; `aria-busy` is set during `isLoading`.

**Usage rule:** exactly one `primary` button per view/section. `destructive` is reserved for irreversible actions and should almost always sit inside a confirmation `Modal`, never as a bare list-row action.

```tsx
<Button variant="primary" leftIcon={<Plus />}>New workspace</Button>
<Button variant="outline" size="sm">Cancel</Button>
<Button variant="destructive" isLoading={isDeleting}>Delete account</Button>
```

---

## 9. Input components

`Input.tsx`, `Textarea.tsx`, `Select.tsx`, `Checkbox.tsx`, `RadioGroup.tsx`, `Switch.tsx`, `Label.tsx`, `FormHelperText.tsx`

All controls share one visual language: `radius-md`, `border-strong` on focus via `ring`, and a uniform **invalid state** — set `invalid`/`aria-invalid` and the border/ring turn `danger` automatically (`aria-[invalid=true]:` variants, no conditional className needed at the call site).

### Text input & textarea

- Sizes `sm` (32px) / `md` (40px, default) / `lg` (48px) on `Input`; `Textarea` sizes via `rows`.
- `leftIcon` / `rightIcon` slots on `Input` (e.g. search, currency prefix, password-visibility toggle) — icon padding is computed per size automatically via `cva` compound variants.

### Select

Radix `Select` wrapped as `Select` / `SelectTrigger` / `SelectContent` / `SelectItem` / `SelectGroup` / `SelectLabel` / `SelectSeparator`. Content is portaled, width-matches the trigger, and supports scroll buttons for long lists.

### Checkbox / RadioGroup / Switch

Radix-backed; `Checkbox` supports `indeterminate`. All three are unstyled-behavior + fully styled, sized at `18px` (`size-4.5`) to sit correctly against 15px body text.

### Label & helper text

`Label` (Radix `Label`, click-to-focus the paired control) takes a `required` prop that appends a styled asterisk. `FormHelperText` takes `variant="default" | "error"` and should be wired via `aria-describedby` on the control — the design system provides the pieces, **form-level composition (react-hook-form + Zod resolvers) is an application concern**, not part of this design-system phase.

```tsx
<div className="space-y-1.5">
  <Label htmlFor="email" required>Work email</Label>
  <Input id="email" type="email" invalid={!!error} describedBy="email-error" />
  {error && <FormHelperText id="email-error" variant="error">{error}</FormHelperText>}
</div>
```

---

## 10. Card

`Card.tsx` — compound: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`.

- `Card` = `radius-xl` + `border` + `shadow-sm` on `surface`. It is the *only* place `shadow-sm` should appear at rest — cards are the system's one "physical" surface.
- Sub-components exist purely for consistent internal padding (`p-6`, header/footer stripped of top/bottom padding respectively) — never hand-roll card padding.

```tsx
<Card>
  <CardHeader>
    <CardTitle>Monthly revenue</CardTitle>
    <CardDescription>Last 30 days</CardDescription>
  </CardHeader>
  <CardContent>{/* chart / stat */}</CardContent>
  <CardFooter><Button size="sm" variant="outline">View report</Button></CardFooter>
</Card>
```

---

## 11. Table

`Table.tsx` — compound: `Table` (wraps in a bordered, horizontally-scrollable container), `TableHeader`, `TableBody`, `TableFooter`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`.

- Header cells: uppercase, `text-xs`, `muted-foreground` — data cells: `text-sm`, `foreground`.
- Rows get `hover:bg-surface-hover`; a `data-state="selected"` row keeps the hover tint permanently — set this attribute instead of a bespoke "selected row" class.
- The wrapper's built-in `overflow-x-auto` means wide tables never break mobile layout — never add a second scroll container around `Table`.
- Pairs with `SkeletonText`/`Skeleton` rows while loading and `EmptyState` inside `TableBody` (a single row spanning all columns) when the result set is empty.

---

## 12. Badge

`Badge.tsx` — `variant`: `neutral` (default) · `brand` · `success` · `warning` · `danger` · `info` · `outline`. Optional `dot` prop renders a small leading status dot instead of using an icon (keeps badges compact in dense tables).

Use for **status, category, or count labels inline with other content** (table cells, card headers). For a dismissible/interactive chip, compose `Badge` with a trailing icon button rather than adding interaction directly to `Badge` — it stays a `<span>`, not a button, by design (so it's never accidentally in the tab order).

---

## 13. Alert

`shared/components/feedback/Alert.tsx` — `variant`: `info` (default) · `success` · `warning` · `danger`. Each variant auto-selects its Lucide icon (`Info` / `CheckCircle2` / `AlertTriangle` / `XCircle`).

- `role="alert"` is set unconditionally — use for **page/section-level, persistent** status messages (form-level submit errors, banner notices). For transient, non-blocking feedback use **Toast** (§20) instead — that's the dividing line between the two components.
- `onDismiss` is optional; omit it for alerts that must stay visible (e.g. "your trial has expired").

---

## 14. Modal

`shared/components/overlay/Modal.tsx` — Radix `Dialog` wrapped as `Modal` (Root) / `ModalTrigger` / `ModalContent` / `ModalHeader` / `ModalTitle` / `ModalDescription` / `ModalBody` / `ModalFooter` / `ModalClose`.

- Sizes `sm`(384px) / `md`(448px, default) / `lg`(512px) / `xl`(672px), always capped to viewport height with internal scroll.
- Focus trap, scroll lock, `Escape`-to-close, and click-outside-to-close are handled by Radix — never reimplement these.
- `ModalTitle` is **required** for every modal (Radix throws a dev warning otherwise) — it's the dialog's accessible name. If a title would be visually redundant, keep the element and hide it visually rather than omitting it (a pattern to add to `shared/lib` once the first such case appears — not needed yet).
- `ModalFooter` stacks actions full-width on mobile, right-aligned on `sm:` and up, with the primary action last in DOM order (so it's reached last by keyboard tab, secondary/cancel first) — this matches the platform convention screen reader and keyboard users expect.

```tsx
<Modal open={open} onOpenChange={setOpen}>
  <ModalContent size="sm">
    <ModalHeader>
      <ModalTitle>Delete workspace?</ModalTitle>
      <ModalDescription>This can't be undone.</ModalDescription>
    </ModalHeader>
    <ModalFooter>
      <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
      <Button variant="destructive">Delete</Button>
    </ModalFooter>
  </ModalContent>
</Modal>
```

---

## 15. Dropdown

`shared/components/overlay/Dropdown.tsx` — Radix `DropdownMenu` wrapped as `Dropdown` / `DropdownTrigger` / `DropdownContent` / `DropdownItem` (with `variant="danger"` for destructive entries) / `DropdownCheckboxItem` / `DropdownRadioGroup` + `DropdownRadioItem` / `DropdownSub` + `DropdownSubTrigger` + `DropdownSubContent` / `DropdownLabel` / `DropdownSeparator` / `DropdownShortcut`.

Use for **action menus** (row "⋯" menus, the `TopNav` user menu). For **navigating/filtering a list of options into a form field**, use `Select` instead — same visual language, different semantics (Dropdown fires actions; Select picks a value).

---

## 16. Sidebar

`shared/components/layout/Sidebar.tsx`

Purely presentational navigation shell — **it does not know about your router.** It renders plain `<a href>` elements and determines the active item by comparing `activeHref` (a string you supply, typically `location.pathname`) against each `NavItem.href`; the parent app decides how routing actually works.

| Prop | Notes |
|---|---|
| `items: NavItem[]` | `{ label, href, icon?, badge?, items? }` — `items` nests one level deep as a collapsible group (Framer Motion height animation) |
| `activeHref` | Compared with prefix-matching (`/settings/billing` is "active" under a `/settings` parent) |
| `collapsed` / `onCollapsedChange` | Desktop icon-rail mode (80px). Omit `onCollapsedChange` to hide the collapse toggle entirely |
| `mobileOpen` / `onMobileOpenChange` | Drives the mobile drawer — owned by `DashboardLayout` in normal usage |
| `logo`, `footer` | Slots (footer typically holds a user menu or plan badge) |

**Responsive behavior:** a static, collapsible rail at `lg` (1024px) and up; below that, a Framer Motion slide-in drawer with backdrop (`role="dialog"`, `aria-modal="true"`, closes on backdrop click). Collapsed-rail items keep their accessible name via `aria-label`/`title` even though the visible label is `sr-only`.

---

## 17. Top Navigation

`shared/components/layout/TopNav.tsx`

Sticky header (`backdrop-blur` + translucent `surface`) composing: mobile menu trigger (calls `onMenuClick`, wired to the Sidebar drawer by `DashboardLayout`), a `leading` slot (breadcrumbs/page title), an optional built-in search `Input`, an `actions` slot (icon buttons — notifications, theme toggle), and a user menu (`Avatar` + `Dropdown`) built from a plain `user` + `userMenuItems` prop.

---

## 18. Dashboard Layout

`shared/components/layout/DashboardLayout.tsx`

The composed application shell: `Sidebar` + `TopNav` + a scrollable `<main>`. It owns exactly two pieces of state — desktop collapsed/expanded (persisted to `localStorage`, key `bizpilot-ai:sidebar-collapsed`) and mobile drawer open/closed (auto-closes on `activeHref` change) — nothing else. Page content is passed as `children`; **this component is a layout wrapper, not a page** — it has no knowledge of what route or data it's wrapping.

```tsx
<DashboardLayout
  navItems={navItems}
  activeHref={location.pathname}
  logo={<Logo />}
  topNav={{ user, userMenuItems, searchPlaceholder: 'Search…' }}
>
  {children}
</DashboardLayout>
```

---

## 19. Loading Skeletons

`shared/components/feedback/Skeleton.tsx` — `Skeleton` (base shimmering block, shape via utility classes), `SkeletonText` (`lines` prop, last line shortened to 60%), `SkeletonAvatar` (`sm`/`md`/`lg`), `SkeletonCard` (pre-composed avatar + text, mirrors the default `Card` shape).

Rule: a skeleton's shape should approximate the real content's shape (a `SkeletonCard` where a `Card` will render, `SkeletonText` lines matching expected line count) — a generic gray box is a worse experience than no skeleton at all. All skeletons are `aria-hidden` with `role="presentation"`; pair with a visually-hidden "Loading…" live region at the container level if the load can take longer than ~1s.

---

## 20. Empty States

`shared/components/feedback/EmptyState.tsx` — icon (in a circular `secondary` badge), title, optional description, and up to two actions (primary `action` + `secondaryAction`).

Use inside any container that can legitimately have zero items: a `Table` body, a `Card`, a full page. Always give the user a next step via `action` (e.g. "Create your first project") rather than describing the emptiness alone — an empty state with no action is a dead end.

---

## Toast notifications

`shared/components/feedback/Toast.tsx` (styled Radix primitives) + `Toaster.tsx` (store + imperative API + renderer).

Mount `<Toaster />` **once**, near the app root. Anywhere else in the app — including outside React (an Axios interceptor, a query-client `onError`) — call the imperative API:

```ts
import { toast } from '@/shared/components/feedback/Toaster';

toast.success('Invoice sent');
toast.danger('Payment failed', { description: 'Card was declined.', duration: Infinity });
toast.show({ title: 'Undo?', action: { label: 'Undo', onClick: revert } });
```

- Variants mirror `Alert`'s (`success`/`warning`/`danger`/`info`) plus a neutral `default`.
- Default auto-dismiss is 5000ms; pass `duration: Infinity` for toasts that require an explicit dismiss/action (e.g. destructive-action confirmations shouldn't auto-vanish).
- Swipe-to-dismiss (touch/trackpad) and pause-on-hover are handled by Radix `Toast` automatically.
- **Toast vs. Alert:** Toast = transient, appears without the user asking, auto-dismisses, stacks. Alert = persistent, embedded in the page/form it's about, stays until the underlying condition changes or the user dismisses it.
