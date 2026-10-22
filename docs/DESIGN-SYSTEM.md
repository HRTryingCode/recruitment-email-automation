# Design system

The frontend is moving to **shadcn/ui, everywhere**: the end state of the
R0–R4 batches is *zero* hand-rolled UI outside `frontend/src/components/ui`.
R0 (this doc's first version) switched the preset, made the registry
components actually work under our Tailwind 3 build, added the components
R1–R4 need, and installed a report-only guard. R1–R4 each refactor one area
to zero findings and switch their area to strict.

## 1. Preset

| | |
|---|---|
| Preset code | **`b7W7uXIq8`** — https://ui.shadcn.com/create?preset=b7W7uXIq8 |
| Resolve | `cd frontend && npx shadcn@4.22.1 preset resolve` → must print `b7W7uXIq8` |
| style | `luma` (`radix-luma` in components.json) |
| baseColor / theme / chartColor | `taupe` / `taupe` / `taupe` |
| iconLibrary | `lucide` |
| font / fontHeading | `inter` (`@fontsource-variable/inter`) / `inherit` |
| radius | default (`--radius: 0.625rem`) |
| menuAccent | `subtle` |
| menuColor | **`default`** (was `inverted-translucent`, preset `b7W7uXIqB`) |

R0's only preset delta was `menuColor`: menus/select popovers are now opaque
`bg-popover` instead of a 70%-opacity backdrop-blur surface (see
`docs/screenshots/r0/cc-select-before-after-*.png`).

## 2. Tailwind 3 — read this before `shadcn add`

We are on **Tailwind 3.4**; the shadcn 4.x registry emits **Tailwind 4**
class syntax. Tailwind 3 doesn't error on it — it silently generates *no
CSS*. Before R0, 126 class tokens in `components/ui` were dead this way
(Tabs active state, Select open/close animation and max-height, Button
icon padding and focus ring width, the select item name/email gap, …).

How R0 fixed it, and what every later batch must keep doing:

1. **`frontend/tailwind.shadcn-compat.ts`** — a Tailwind 3 plugin mirroring
   shadcn's `@custom-variant`s (`data-open`, `data-closed`, `data-active`,
   `data-checked`, `data-horizontal`, `data-vertical`, `data-disabled`, …),
   Tailwind 4's bare boolean variants (`data-highlighted`, `data-placeholder`,
   `aria-invalid`), and the v4-only scale steps (`ring-3`, `z-1`, `pl-18`,
   `underline-offset-3`, `shadow-xs`, `font-heading`, `outline-hidden`,
   `field-sizing-content`, `no-scrollbar`).
2. **`frontend/scripts/tw4-to-tw3.mjs`** — codemod for structural v4 syntax:
   `max-h-(--x)` → `max-h-[var(--x)]`, trailing `!` → leading `!`, `**:` /
   `*:[sel]:` / `[sel]:` → `[&_…]` / `[&>sel]` / `[&:is(sel)]`, `has-data-[…]`
   → `has-[[data-…]]`, `not-*`, `in-*`, `supports-x`, `--spacing(n)`, and it
   **reverses variant order** (v3 applies stacked variants right-to-left, v4
   left-to-right). Not idempotent, so converted files carry an
   `@tw3-converted` marker and are skipped on re-runs.
3. **`__tests__/design-system/tw3-classes.test.ts`** (strict) — fails if any
   file in `components/ui` has a class that compiles to nothing.

### Adding a shadcn component (R1–R4 checklist)

```bash
cd frontend
npx shadcn@4.22.1 add <name> --dry-run          # see what it would overwrite
npx shadcn@4.22.1 add <name> --overwrite -y </dev/null
git checkout -- <every pre-existing ui file it overwrote>   # keep our converted versions
sed -i '' 's#from "cn"#from "@/lib/utils"#' src/components/ui/<new>.tsx
node scripts/tw4-to-tw3.mjs src/components/ui/<new>.tsx
node scripts/tw3-dead-classes.mjs src/components/ui/*.tsx   # must print 0
# if the CLI added "cn" to package.json dependencies, remove it again
```

**Never run `shadcn apply` / `shadcn init`**: on this repo they migrate
`index.css` to Tailwind 4 (`@import "shadcn/tailwind.css"`), rewrite
`lib/utils.ts` to re-export an npm package called `cn` (deleting
`formatTimeAgo`/`formatDate`), and switch `ui/sonner` to `next-themes`, which
breaks our own theme sync (`lib/theme.ts`).

## 3. Tokens

All colours come from CSS variables in `frontend/src/index.css` (`:root` =
light, `.dark` = dark; `lib/theme.ts` toggles the class), wired into
Tailwind in `tailwind.config.ts` so alpha works (`bg-primary/80`).

### shadcn tokens — use these

| Token (CSS var) | Tailwind | Use for |
|---|---|---|
| `--background` / `--foreground` | `bg-background` `text-foreground` | page surface, default text |
| `--card` / `--card-foreground` | `bg-card` `text-card-foreground` | via `ui/card` |
| `--popover` / `--popover-foreground` | `bg-popover` … | via menu/select/popover components |
| `--primary` / `--primary-foreground` | `bg-primary` `text-primary-foreground` | primary actions (`Button` default) |
| `--secondary` / `--secondary-foreground` | `bg-secondary` … | secondary actions |
| `--muted` / `--muted-foreground` | `bg-muted` `text-muted-foreground` | subdued surfaces, secondary text |
| `--accent` / `--accent-foreground` | `bg-accent` `text-accent-foreground` | hover/highlight (menus) — **not** the purple ramp, see below |
| `--destructive` | `bg-destructive` `text-destructive` | errors, discard, reconnect-required |
| `--border` / `--input` / `--ring` | `border-border` `border-input` `ring-ring` | hairlines, fields, focus |
| `--chart-1` … `--chart-5` | `fill-chart-1` / `var(--chart-1)` | `ui/chart` series only |
| `--sidebar-*` | `bg-sidebar` … | via `ui/sidebar` (app shell) |
| `--radius` | `rounded-lg/md/sm` derive from it | owned by ui components |

### Legacy tokens — being removed by R1–R4

These predate shadcn and are what the audit counts as `legacy-token`
(~530 uses). Map them like this:

| Legacy | Replace with |
|---|---|
| `text-fg-strong`, `text-fg-default`, `text-ink-50…200` | `text-foreground` |
| `text-fg-muted`, `text-fg-subtle`, `text-ink-300…600` | `text-muted-foreground` |
| `bg-surface-base` | `bg-background` |
| `bg-surface-raised` | `bg-card` (or just use `ui/card`) |
| `bg-surface-elevated`, `bg-surface-overlay`, `bg-ink-700…900` | `bg-muted` / `bg-popover` |
| `bg-fg-strong/[0.03…0.06]` (hover tints) | `bg-muted` / `hover:bg-muted` |
| `ring-fg-strong/[0.08]`, `border-line*`, `divide-line` | `ring-foreground/10`, `border-border`, `divide-border` |
| `accent-300…900` (old purple ramp, incl. `from-/to-accent-*` gradients) | `primary` (full taupe, see below) |
| emerald / rose / amber / sky Tailwind palette classes | `success` / `destructive` / `warning` / `info` (added in R1) |
| `--glow-*`, `--grid-line`, `.grid-bg`, `shadow-glow`, `shadow-card-hover` | delete |
| `.card-hover`, `.skeleton` (`index.css` `@layer components`; R1 deleted `.card`, `.hairline`, `.grid-bg`) | `ui/card`, `ui/separator`, `ui/skeleton` |

Note the name clash: in `tailwind.config.ts`, `accent` is *both* shadcn's
`--accent` (`bg-accent`) and the legacy purple ramp (`bg-accent-500`). R1
should remove the numbered ramp once R2–R4 no longer use it (the last batch
removes it if R1 can't).

### Brand colour: full taupe (decided 2026-10-22, R1)

Andriy chose **full taupe** — there is no purple anywhere. `--primary` is the
preset's taupe (near-black in light, near-white in dark) and is the only
"brand" colour: primary buttons, active nav, focus rings, the logo, avatars.

Colour means state, and only state:

| Meaning | Token | Tailwind / component |
|---|---|---|
| interested, OK, healthy | `--success` | `text-success`, `bg-success/10`, `<Badge variant="success">` |
| unsure, needs review, warning | `--warning` | `text-warning`, `<Badge variant="warning">`, `<Alert variant="warning">` |
| not interested, error, reconnect required | `--destructive` | `text-destructive`, `variant="destructive"` |
| informational (e.g. "contacted, no reply") | `--info` | `text-info`, `<Badge variant="info">` |
| everything else | taupe neutrals | `foreground`, `muted-foreground`, `secondary`, `border` |

Each has a `-foreground` pair, light + dark values in `index.css`.

**How R1 removed purple without touching R2–R4 screens** (token layer only):

- The legacy `accent-50…900` ramp resolves through `--accent-<n>` CSS
  variables that point at taupe tokens (light: tints for 50–200, `--primary`
  above; dark: light taupe for 50–400 because those are used as text,
  a mid taupe for 500–700 because those sit under `text-white`).
- Tailwind's `violet` / `purple` / `indigo` / `fuchsia` palettes are mapped
  onto the same ramp (e.g. LeverBadge's `bg-violet-500/10`).
- Legacy `fg-*`, `surface-*`, `line`, `ink-*` classes resolve to the shadcn
  tokens; `shadow-glow` / `shadow-card-hover` are neutral; the body glow
  gradients, `.card`, `.hairline` and `.grid-bg` are gone (`.card-hover` and
  `.skeleton` stay until their last R2–R4 user is refactored).
- `__tests__/design-system/theme-tokens.test.ts` compiles the real app CSS
  and fails on any purple colour literal (hex, rgb triplet or oklch hue).

R2–R4 still replace the legacy class names with the shadcn ones in their
screens; the last batch deletes the legacy mappings from `tailwind.config.ts`.

## 4. Component inventory (`frontend/src/components/ui`)

| Component | R0 status | Intended use |
|---|---|---|
| `alert` | refreshed (unchanged) | inline notices (mailbox reconnect, sender coverage) |
| `alert-dialog` | refreshed (Tailwind 3 equivalent) | discard / destructive confirms |
| `badge` | refreshed (unchanged) | role chips, counts, Lever state |
| `button` | **refreshed** — secondary hover via `color-mix`; `forwardRef` (React 18, for Radix `asChild` triggers); R2 adds `size="row"` for list rows | every clickable control; `asChild` for links and Radix triggers |
| `card` | **refreshed** — single `--card-spacing` variable | dashboard tiles, panels |
| `dialog` | refreshed (Tailwind 3 equivalent) | modals (Add to Lever, lookup) |
| `empty` | refreshed (unchanged) | empty states |
| `input` | refreshed (unchanged) | text fields |
| `label` | refreshed (unchanged) | form labels |
| `select` | **refreshed** — menuColor default (opaque) | single-choice pickers (CC, mailbox, filters) |
| `separator` | refreshed (unchanged) | dividers |
| `skeleton` | refreshed (unchanged) | loading placeholders |
| `table` | refreshed (unchanged) | candidate table, mailbox health |
| `tabs` | refreshed (unchanged) | main nav, draft status tabs |
| `tooltip` | **refreshed** — `Kbd` slot support | icon-button hints, replaces `title=` |
| `sonner` | kept local (our theme sync, not `next-themes`) | toasts via `lib/toast.ts` |
| `StatusBadge` | kept local (app-specific status → colour map) | candidate/draft status pills — still uses palette colours; move them onto the R1 `success`/`warning`/`info` tokens |
| `avatar` | **new** | user/candidate initials (replaces `Avatar` in `Index.tsx`, list avatars) |
| `chart` | **new** (+ `recharts` 3.8.0) | Dashboard (R2) |
| `checkbox` | **new** | bulk-select / toggles in tables |
| `collapsible` | **new** | Sender coverage / Mailbox health disclosure panels (R2) |
| `command` | **new** (+ `cmdk` 1.1.1) | ⌘K LookupBar combobox (R3), searchable pickers |
| `dropdown-menu` | **new** | account menu (R1), row actions |
| `input-group` | **new** (dep of command) | search fields with icons (replaces absolute-positioned icons) |
| `kbd` | **new** | ⌘K / `?` shortcut hints |
| `pagination` | **new** | candidate/draft lists |
| `popover` | **new** | filter popovers, combobox shell |
| `scroll-area` | **new** | draft list / review pane scrolling |
| `sheet` | **new** | DraftReviewPane side panel (R4) |
| `spinner` | **new** | replaces `Loader2 animate-spin` |
| `textarea` | **new** | draft body editor, dictation notes (R4) |
| `toggle`, `toggle-group` | **new** | segmented filters (draft status, reply status) |

Added in R1: **`sidebar`** (+ `hooks/use-mobile.ts`) for the app shell —
collapsible to icons on desktop, a Sheet on mobile, ⌘B toggles it. `badge`
gained `success` / `warning` / `info` variants and `alert` a `warning`
variant. `navigation-menu` is still not needed.

### App shell (R1)

| Piece | File | Notes |
|---|---|---|
| Layout route | `components/shell/AppShell.tsx` | Sidebar + header + status banner + `<Outlet/>` |
| Nav items | `components/shell/nav.ts` | Inbox, Candidates, Today, Settings (+ `g`-key) |
| Header | `components/shell/AppHeader.tsx` | ⌘K trigger, mailbox filter, theme, account menu |
| ⌘K palette | `components/LookupBar.tsx` | email lookup first, then Go to / Actions |
| Shortcut help | `components/shell/ShortcutsDialog.tsx` | `?`, `g i/c/t/s` |
| Status banner | `components/shell/StatusBanner.tsx` | reconnect-needed mailboxes, dismiss per session |
| URL state | `lib/urlState.ts`, `lib/legacyRedirect.ts` | `?mailboxId=` is global; view params reset on view switch; `/?tab=` redirects |
| Settings | `pages/settings/*`, `components/settings/*` | Mailboxes, Integrations, Team |

## 5. Rules for R1–R4

1. **Only `@/components/ui/*` for UI primitives.** No raw `<button>`,
   `<input>`, `<select>`, `<textarea>`, `<table>`/`<tr>`/`<td>`, `<label>`,
   `<kbd>`, `<dialog>`; no hand-built overlays, popovers, comboboxes,
   disclosures, spinners, skeletons or tooltips (`title=`). If ui/ lacks
   something, add it with the §2 checklist; don't build it inline.
2. **No direct Radix imports** outside ui/ (`@radix-ui/*`, `radix-ui`).
3. **Colours only via tokens** (§3). No hex/rgb/hsl/oklch, no Tailwind
   palette classes (`text-rose-600`, `bg-emerald-500/10`, `text-white`), no
   legacy tokens. Status colours: `success` / `warning` / `info` /
   `destructive` (§3) — map emerald / amber / sky / rose onto them.
4. **No ad-hoc shadows, radii or z-index.** Elevation, rounding and stacking
   belong to the components (`Card`, `Popover`, `Dialog`, `Sheet`). Outside
   ui/, `shadow-*`, `rounded-*` and `z-*` should disappear; the exceptions are
   `rounded-full` on a deliberate circle that isn't an avatar (use `Avatar` for
   people) and layout-only `z-*`, each justified in the PR.
5. **Type and spacing scale only.** No `text-[11.5px]`, `tracking-[0.14em]`,
   `w-[18px]`: use `text-xs`/`text-sm`, `tracking-wide`, `size-4`. If a size
   really is needed in several places, it becomes a component variant.
6. **Icons: `lucide-react` only**, sized by the component (`[&_svg]:size-4`)
   or `size-*`. No inline `<svg>`.
7. **Dark mode via tokens only.** No `dark:` colour overrides outside ui/:
   if something needs a `dark:` colour, its token is wrong.
8. **`style={{}}` only for truly dynamic values** (computed widths, chart
   colours passed as CSS variables), never for static styling.
9. **No behaviour changes.** Keep the existing tests green; refactors that
   change DOM roles/labels update tests deliberately, and the PR says why.
10. **Done means zero.** Your area's count in §7 goes to 0. Add the area to
    `STRICT_AREAS` in `frontend/__tests__/design-system/hotspots.test.ts`,
    regenerate §7 (`node scripts/design-system-audit.mjs --write-docs`), and
    include before/after screenshots (`docs/screenshots/capture.mjs`).

## 6. Enforcement

| Guard | Where | Mode now | Who flips it |
|---|---|---|---|
| ui/ compiles under Tailwind 3 | `__tests__/design-system/tw3-classes.test.ts` | **strict** | — |
| No purple (full taupe) | `__tests__/design-system/theme-tokens.test.ts` | **strict** | — |
| Hand-rolled UI per batch | `__tests__/design-system/hotspots.test.ts` + `scripts/design-system-audit.mjs` | **R1 strict**; R2–R4 report-only (prints the per-batch baseline on every `npm test` / CI run) | each batch adds its area to `STRICT_AREAS` |
| ESLint `no-restricted-syntax` / `no-restricted-imports` | `frontend/eslint.config.mjs`, `npm run lint:ds` | `warn` (exit 0) | the last batch sets `DS_SEVERITY = 'error'` |
| CI | `.github/workflows/test.yml` → "Design-system baseline (report-only)" | prints `audit:ds` + the ESLint warning count | — |

The audit rules (ids used in §7): `raw-button`, `raw-input`, `raw-select`,
`raw-textarea`, `raw-table`, `raw-label`, `raw-img`, `raw-svg`, `raw-kbd`,
`raw-dialog`, `custom-overlay`, `custom-combobox`, `custom-disclosure`,
`input-adornment`, `direct-radix`, `custom-spinner`, `custom-skeleton`,
`native-tooltip`, `non-lucide-icon`, `hex-colour`, `css-colour-fn`,
`palette-colour`, `legacy-token`, `legacy-css-class`, `decorative-effect`,
`ad-hoc-shadow`, `ad-hoc-radius`, `ad-hoc-z-index`, `arbitrary-value`,
`inline-style`. Each rule's "use instead" text is in `RULES` in
`scripts/design-system-audit.mjs`. A line can hit several rules; whole-line
comments are ignored.

Ownership: `R1` = everything not claimed below (pages, App, main, shell
components, `lib/`, other hooks, and any **new** file) · `R2` = the Inbox
(`pages/InboxPage`, `components/inbox/*`, `useInbox*`/`useDraftEditor`/
`useDraftPresence`, `DraftCcSelect`, `lib/inbox`) — the old EmailDrafts,
DraftReviewPane and useDraftKeyboardShortcuts were deleted when the Inbox
was mounted · `R3` = CandidateTable, LookupBar, LookupIntegrations,
LeverBadge, AddToLeverButton, AddToLeverDialog, JobCombobox, GemConnect,
GemReturnToast · `R4` = the Today page: Dashboard, UnmonitoredSenders. New
feature files default to R1. If one belongs elsewhere, add it to
`AREA_BY_FILE`.

## 7. Hotspot inventory

Generated by `node scripts/design-system-audit.mjs --write-docs` (from
`frontend/`); don't edit by hand. Line numbers are as of the commit that last
regenerated it.

<!-- audit:start -->
| Batch | Scope | Findings |
|---|---|---:|
| R1 | Shell — App, main, pages (Login, NotFound, route pages, settings), components/shell + settings, ThemeToggle, MailboxFilter, ProtectedRoute, lib, hooks | 0 |
| R2 | Inbox — InboxPage, components/inbox/*, inbox hooks, DraftCcSelect, lib/inbox | 0 |
| R3 | Candidates — CandidateTable, LookupBar, LookupIntegrations, LeverBadge, AddToLever*, JobCombobox, Gem* | 282 |
| R4 | Today — Dashboard, UnmonitoredSenders | 129 |
| **Total** | | **411** |

### R1 — Shell (0)

_none_

### R2 — Inbox (0)

_none_

### R3 — Candidates (282)

`legacy-token` 120 · `arbitrary-value` 45 · `palette-colour` 35 · `ad-hoc-radius` 24 · `raw-table` 19 · `raw-button` 13 · `custom-spinner` 5 · `input-adornment` 5 · `custom-skeleton` 3 · `raw-select` 3 · `native-tooltip` 3 · `ad-hoc-shadow` 2 · `css-colour-fn` 2 · `raw-input` 1 · `custom-combobox` 1 · `custom-disclosure` 1

**`src/components/AddToLeverButton.tsx`** (7)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (1) | 47 | `<button` |
| `legacy-token` (4) | 57 | `text-accent-700` `ring-accent-500/20` `hover:bg-accent-500/10` `dark:text-accent-300` |
| `ad-hoc-radius` (1) | 57 | `rounded-md` |
| `arbitrary-value` (1) | 57 | `text-[11.5px]` |

**`src/components/AddToLeverDialog.tsx`** (15)

| Rule | Lines | Examples |
|---|---|---|
| `custom-spinner` (5) | 69, 117, 284, 375, 415 | `animate-spin` |
| `custom-skeleton` (2) | 68, 374 | `animate-pulse` |
| `palette-colour` (4) | 255 | `bg-amber-500/10` `text-amber-800` `ring-amber-500/20` `dark:text-amber-200` |
| `ad-hoc-radius` (2) | 255, 394 | `rounded-lg` `rounded-2xl` |
| `arbitrary-value` (2) | 90, 255 | `max-h-[90vh]` `text-[12.5px]` |

**`src/components/CandidateTable.tsx`** (217)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (10) | 168, 238, 498, 662, 670, 782, 829, 839, 856, 899 | `<button` |
| `raw-input` (1) | 490 | `<input` |
| `raw-select` (3) | 455, 475, 809 | `<select` |
| `raw-table` (19) | 232, 518, 519, 520, 531, 542, 547, 550, 552, 712, 716, 757, 763, 773, 776, 795, 802, 872, 873 | `<th` `<table` `<thead` `<tr` |
| `input-adornment` (5) | 472, 486, 489, 503, 825 | `pointer-events-none absolute` `absolute right-2.5 top-1/2 -translate-y-1/2` |
| `custom-skeleton` (1) | 173 | `animate-pulse` |
| `native-tooltip` (3) | 740, 834, 859 | ` title="` |
| `css-colour-fn` (2) | 804 | `rgb(` |
| `palette-colour` (21) | 71, 73, 118, 176, 425, 784, 835, 902 | `bg-emerald-500/10` `text-emerald-700` `ring-emerald-500/20` `dark:text-emerald-300` |
| `legacy-token` (96) | 74, 144, 149, 152, 155, 159, 171, 243, 424, 443, 446, 459, 472, 480, 486, 489, 495, 503, 509, 516, 520, 531, 542, 547, 603, 606, 609, 656, 666, 674, 713, 719, 721, 724, 731, 739, 758, 759, 765, 766, 770, 784, 796, 804, 814, 825, 843, 861, 875, 902 | `bg-fg-strong/[0.04]` `text-fg-muted` `ring-fg-strong/[0.06]` `text-fg-subtle` |
| `ad-hoc-shadow` (2) | 542, 804 | `shadow-[-1px_0_0_rgb(var(--fg-strong)/0.06)]` |
| `ad-hoc-radius` (18) | 111, 149, 171, 424, 459, 480, 495, 514, 516, 666, 674, 731, 739, 814, 835, 843, 861, 902 | `rounded-lg` `rounded-xl` `rounded` `rounded-md` |
| `arbitrary-value` (36) | 86, 118, 144, 152, 155, 159, 171, 176, 242, 443, 446, 459, 480, 488, 495, 509, 531, 542, 606, 609, 656, 666, 674, 724, 731, 739, 758, 765, 770, 796, 814, 835, 843 | `text-[11px]` `text-[13px]` `text-[12.5px]` `text-[12px]` |

**`src/components/GemConnect.tsx`** (12)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (1) | 51 | `<button` |
| `palette-colour` (2) | 48 | `text-amber-700` `dark:text-amber-300` |
| `legacy-token` (6) | 48, 55 | `text-fg-default` `text-fg-muted` `text-accent-700` `ring-accent-500/20` |
| `ad-hoc-radius` (1) | 55 | `rounded-md` |
| `arbitrary-value` (2) | 47, 55 | `text-[13px]` `text-[12px]` |

**`src/components/JobCombobox.tsx`** (5)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (1) | 68 | `<button` |
| `custom-combobox` (1) | 70 | `role="combobox"` |
| `custom-disclosure` (1) | 72 | `aria-expanded={` |
| `ad-hoc-radius` (1) | 76 | `rounded-3xl` |
| `arbitrary-value` (1) | 88 | `w-[--radix-popover-trigger-width]` |

**`src/components/LeverBadge.tsx`** (24)

| Rule | Lines | Examples |
|---|---|---|
| `palette-colour` (8) | 13, 14 | `bg-violet-500/10` `text-violet-700` `ring-violet-500/20` `dark:text-violet-300` |
| `legacy-token` (13) | 15, 16, 17, 18, 155 | `bg-fg-strong/[0.05]` `text-fg-default` `ring-fg-strong/[0.08]` `bg-fg-strong/[0.03]` |
| `ad-hoc-radius` (1) | 10 | `rounded-md` |
| `arbitrary-value` (2) | 10, 155 | `text-[11.5px]` `text-[12px]` |

**`src/components/LookupIntegrations.tsx`** (2)

| Rule | Lines | Examples |
|---|---|---|
| `legacy-token` (1) | 28 | `text-fg-muted` |
| `arbitrary-value` (1) | 24 | `text-[13px]` |

### R4 — Today (129)

`legacy-token` 52 · `palette-colour` 42 · `arbitrary-value` 16 · `ad-hoc-radius` 12 · `raw-button` 3 · `native-tooltip` 3 · `ad-hoc-shadow` 1

**`src/components/Dashboard.tsx`** (129)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (3) | 76, 119, 171 | `<button` |
| `native-tooltip` (3) | 122, 410, 422 | ` title={`` ` title="` |
| `palette-colour` (42) | 61, 62, 66, 67, 71, 72, 123, 164, 173, 191, 192, 193 | `hover:border-amber-400/50` `group-hover:text-amber-700` `dark:group-hover:text-amber-200` `hover:border-emerald-400/50` |
| `legacy-token` (52) | 60, 65, 70, 71, 72, 80, 106, 108, 110, 147, 149, 153, 156, 159, 163, 194, 241, 245, 273, 278, 281, 284, 356, 359, 409, 414, 426 | `hover:border-accent-400/50` `group-hover:text-accent-500` `dark:group-hover:text-accent-200` `bg-accent-500/12` |
| `ad-hoc-shadow` (1) | 80 | `hover:shadow-card-hover` |
| `ad-hoc-radius` (12) | 80, 86, 123, 149, 173, 207, 235, 245, 273, 414, 416, 426 | `rounded-2xl` `rounded-xl` `rounded-md` `rounded-lg` |
| `arbitrary-value` (16) | 90, 99, 106, 108, 123, 153, 156, 173, 207, 241, 245, 281, 284, 356, 359 | `h-[18px]` `w-[18px]` `text-[34px]` `text-[13px]` |

<!-- audit:end -->

## 8. Visual verification

`docs/screenshots/capture.mjs` renders Login, Dashboard (+ open account
menu), Candidates, Drafts, the draft review pane and the open CC select in
light and dark against `vite dev`, with every `/api/*` call answered from
fake fixtures (no backend, no real data):

```bash
cd frontend && npx vite --port 5173 &
cd <scratch dir> && npm i playwright@1.59.1 && npx playwright install chromium
node /path/to/docs/screenshots/capture.mjs ./shots http://localhost:5173
```

R0's before/after shots are in `docs/screenshots/r0/{before,after}/`.
