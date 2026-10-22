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
| `button` | **refreshed** — secondary hover via `color-mix` | every clickable control; `asChild` for links |
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
components, `lib/`, other hooks, and any **new** file) · `R2` = Dashboard,
UnmonitoredSenders · `R3` = CandidateTable, LookupBar, LookupIntegrations,
LeverBadge, AddToLeverButton, AddToLeverDialog, JobCombobox, GemConnect, GemReturnToast · `R4` =
EmailDrafts, DraftReviewPane, DraftCcSelect, useDraftKeyboardShortcuts. New
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
| R2 | Dashboard — Dashboard, UnmonitoredSenders | 180 |
| R3 | Candidates — CandidateTable, LookupBar, LookupIntegrations, LeverBadge, AddToLever*, JobCombobox, Gem* | 278 |
| R4 | Drafts — EmailDrafts, DraftReviewPane, DraftCcSelect, useDraftKeyboardShortcuts | 302 |
| **Total** | | **760** |

### R1 — Shell (0)

_none_

### R2 — Dashboard (180)

`legacy-token` 76 · `palette-colour` 49 · `arbitrary-value` 23 · `ad-hoc-radius` 19 · `raw-button` 6 · `native-tooltip` 5 · `ad-hoc-shadow` 1 · `decorative-effect` 1

**`src/components/Dashboard.tsx`** (180)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (6) | 85, 184, 193, 209, 261, 559 | `<button` |
| `decorative-effect` (1) | 162 | `bg-gradient-to-br` |
| `native-tooltip` (5) | 212, 555, 578, 603, 615 | ` title={`` ` title="` |
| `palette-colour` (49) | 70, 71, 75, 76, 80, 81, 162, 188, 213, 254, 263, 281, 282, 283 | `hover:border-amber-400/50` `group-hover:text-amber-700` `dark:group-hover:text-amber-200` `hover:border-emerald-400/50` |
| `legacy-token` (76) | 69, 74, 79, 80, 81, 89, 115, 117, 119, 159, 162, 167, 171, 178, 196, 237, 239, 243, 246, 249, 253, 284, 331, 335, 363, 368, 371, 374, 501, 504, 554, 561, 569, 582, 602, 607, 619 | `hover:border-accent-400/50` `group-hover:text-accent-500` `dark:group-hover:text-accent-200` `bg-accent-500/12` |
| `ad-hoc-shadow` (1) | 89 | `hover:shadow-card-hover` |
| `ad-hoc-radius` (19) | 89, 95, 162, 171, 188, 196, 213, 239, 263, 297, 325, 335, 363, 569, 571, 582, 607, 609, 619 | `rounded-2xl` `rounded-xl` `rounded-full` `rounded-md` |
| `arbitrary-value` (23) | 99, 108, 115, 117, 162, 167, 171, 178, 188, 213, 243, 246, 263, 297, 331, 335, 371, 374, 501, 504, 561 | `h-[18px]` `w-[18px]` `text-[34px]` `text-[13px]` |

### R3 — Candidates (278)

`legacy-token` 120 · `arbitrary-value` 45 · `palette-colour` 35 · `ad-hoc-radius` 24 · `raw-table` 19 · `raw-button` 13 · `input-adornment` 5 · `custom-spinner` 3 · `raw-select` 3 · `native-tooltip` 3 · `ad-hoc-shadow` 2 · `css-colour-fn` 2 · `custom-skeleton` 1 · `raw-input` 1 · `custom-combobox` 1 · `custom-disclosure` 1

**`src/components/AddToLeverButton.tsx`** (7)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (1) | 41 | `<button` |
| `legacy-token` (4) | 49 | `text-accent-700` `ring-accent-500/20` `hover:bg-accent-500/10` `dark:text-accent-300` |
| `ad-hoc-radius` (1) | 49 | `rounded-md` |
| `arbitrary-value` (1) | 49 | `text-[11.5px]` |

**`src/components/AddToLeverDialog.tsx`** (11)

| Rule | Lines | Examples |
|---|---|---|
| `custom-spinner` (3) | 103, 258, 380 | `animate-spin` |
| `palette-colour` (4) | 229 | `bg-amber-500/10` `text-amber-800` `ring-amber-500/20` `dark:text-amber-200` |
| `ad-hoc-radius` (2) | 229, 365 | `rounded-lg` `rounded-2xl` |
| `arbitrary-value` (2) | 77, 229 | `max-h-[90vh]` `text-[12.5px]` |

**`src/components/CandidateTable.tsx`** (217)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (10) | 167, 237, 497, 658, 666, 778, 825, 835, 852, 895 | `<button` |
| `raw-input` (1) | 489 | `<input` |
| `raw-select` (3) | 454, 474, 805 | `<select` |
| `raw-table` (19) | 231, 517, 518, 519, 530, 541, 546, 549, 551, 708, 712, 753, 759, 769, 772, 791, 798, 868, 869 | `<th` `<table` `<thead` `<tr` |
| `input-adornment` (5) | 471, 485, 488, 502, 821 | `pointer-events-none absolute` `absolute right-2.5 top-1/2 -translate-y-1/2` |
| `custom-skeleton` (1) | 172 | `animate-pulse` |
| `native-tooltip` (3) | 736, 830, 855 | ` title="` |
| `css-colour-fn` (2) | 800 | `rgb(` |
| `palette-colour` (21) | 70, 72, 117, 175, 424, 780, 831, 898 | `bg-emerald-500/10` `text-emerald-700` `ring-emerald-500/20` `dark:text-emerald-300` |
| `legacy-token` (96) | 73, 143, 148, 151, 154, 158, 170, 242, 423, 442, 445, 458, 471, 479, 485, 488, 494, 502, 508, 515, 519, 530, 541, 546, 599, 602, 605, 652, 662, 670, 709, 715, 717, 720, 727, 735, 754, 755, 761, 762, 766, 780, 792, 800, 810, 821, 839, 857, 871, 898 | `bg-fg-strong/[0.04]` `text-fg-muted` `ring-fg-strong/[0.06]` `text-fg-subtle` |
| `ad-hoc-shadow` (2) | 541, 800 | `shadow-[-1px_0_0_rgb(var(--fg-strong)/0.06)]` |
| `ad-hoc-radius` (18) | 110, 148, 170, 423, 458, 479, 494, 513, 515, 662, 670, 727, 735, 810, 831, 839, 857, 898 | `rounded-lg` `rounded-xl` `rounded` `rounded-md` |
| `arbitrary-value` (36) | 85, 117, 143, 151, 154, 158, 170, 175, 241, 442, 445, 458, 479, 487, 494, 508, 530, 541, 602, 605, 652, 662, 670, 720, 727, 735, 754, 761, 766, 792, 810, 831, 839 | `text-[11px]` `text-[13px]` `text-[12.5px]` `text-[12px]` |

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

### R4 — Drafts (302)

`legacy-token` 138 · `arbitrary-value` 47 · `palette-colour` 37 · `ad-hoc-radius` 31 · `raw-button` 13 · `decorative-effect` 6 · `custom-spinner` 5 · `ad-hoc-shadow` 4 · `custom-combobox` 4 · `ad-hoc-z-index` 3 · `raw-dialog` 2 · `legacy-css-class` 2 · `raw-textarea` 2 · `hex-colour` 2 · `raw-kbd` 2 · `custom-overlay` 1 · `inline-style` 1 · `native-tooltip` 1 · `custom-skeleton` 1

**`src/components/DraftCcSelect.tsx`** (12)

| Rule | Lines | Examples |
|---|---|---|
| `palette-colour` (2) | 75 | `text-amber-700` `dark:text-amber-300` |
| `legacy-token` (5) | 45, 58, 67 | `text-fg-subtle` `border-line` `bg-surface-base/60` `text-fg-default` |
| `ad-hoc-radius` (1) | 58 | `rounded-md` |
| `arbitrary-value` (4) | 45, 58, 67, 75 | `text-[11px]` `text-[12px]` `text-[11.5px]` |

**`src/components/DraftReviewPane.tsx`** (180)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (10) | 171, 416, 462, 583, 624, 652, 665, 681, 698, 711 | `<button` |
| `raw-textarea` (2) | 495, 558 | `<textarea` |
| `decorative-effect` (2) | 401, 410 | `backdrop-blur-sm` `backdrop-blur-xl` |
| `raw-dialog` (1) | 406 | `role="dialog"` |
| `custom-overlay` (1) | 401 | `fixed inset-0` |
| `custom-spinner` (5) | 579, 633, 659, 688, 724 | `animate-spin` |
| `custom-skeleton` (1) | 568 | `animate-pulse` |
| `native-tooltip` (1) | 535 | ` title="` |
| `hex-colour` (2) | 525 | `#1a1a1a` `#0066cc` |
| `palette-colour` (28) | 174, 401, 505, 548, 568, 576, 589, 629, 656, 668 | `bg-rose-500/10` `text-rose-700` `ring-rose-500/20` `hover:bg-rose-500/15` |
| `legacy-token` (77) | 123, 124, 125, 131, 132, 135, 136, 141, 142, 146, 148, 152, 410, 413, 419, 436, 441, 444, 451, 458, 465, 485, 486, 498, 505, 522, 539, 540, 553, 554, 562, 567, 576, 590, 618, 656, 685, 702, 719, 720 | `border-line` `bg-surface-base/40` `border-line-soft` `bg-fg-strong/[0.015]` |
| `legacy-css-class` (2) | 475, 476 | `className="h-24 skeleton` `className="h-40 skeleton` |
| `ad-hoc-shadow` (1) | 410 | `shadow-2xl` |
| `ad-hoc-radius` (20) | 123, 174, 419, 451, 465, 475, 476, 498, 522, 539, 553, 562, 568, 587, 629, 656, 668, 685, 702, 717 | `rounded-xl` `rounded-lg` `rounded-md` `rounded-full` |
| `ad-hoc-z-index` (2) | 401, 410 | `z-40` `z-50` |
| `arbitrary-value` (24) | 125, 129, 148, 152, 174, 410, 436, 441, 444, 451, 458, 485, 498, 540, 548, 554, 562, 567, 629, 656, 668 | `text-[10px]` `tracking-[0.14em]` `text-[11.5px]` `text-[13px]` |
| `inline-style` (1) | 528 | `style={{` |

**`src/components/EmailDrafts.tsx`** (105)

| Rule | Lines | Examples |
|---|---|---|
| `raw-button` (3) | 98, 720, 832 | `<button` |
| `raw-kbd` (2) | 254, 708 | `<kbd` |
| `decorative-effect` (4) | 116, 118, 120, 835 | `bg-gradient-to-br` `backdrop-blur` |
| `palette-colour` (7) | 114, 116, 118, 685 | `text-white` `from-emerald-500/80` `to-emerald-700/80` `from-rose-500/80` |
| `legacy-token` (56) | 106, 108, 109, 114, 120, 130, 135, 143, 150, 153, 158, 195, 197, 200, 203, 247, 252, 254, 684, 703, 706, 708, 718, 731, 732, 739, 746, 748, 756, 835 | `border-accent-400` `bg-accent-500/[0.08]` `border-line-strong` `bg-fg-strong/[0.03]` |
| `ad-hoc-shadow` (3) | 254, 731, 835 | `shadow-sm` `shadow-lg` |
| `ad-hoc-radius` (10) | 114, 143, 254, 684, 708, 718, 729, 746, 750, 835 | `rounded-full` `rounded-md` `rounded-xl` `rounded` |
| `ad-hoc-z-index` (1) | 835 | `z-30` |
| `arbitrary-value` (19) | 114, 129, 135, 143, 150, 153, 200, 203, 234, 237, 247, 252, 254, 703, 706, 708, 729, 739 | `text-[11px]` `text-[13px]` `text-[10.5px]` `max-w-[160px]` |

**`src/hooks/useDraftKeyboardShortcuts.ts`** (5)

| Rule | Lines | Examples |
|---|---|---|
| `custom-combobox` (4) | 65, 76 | `role="menuitem"` `role="combobox"` `role="listbox"` `role="option"` |
| `raw-dialog` (1) | 47 | `role="dialog"` |

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
