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
  gradients, `.card`, `.hairline` and `.grid-bg` are gone; U2a deleted the
  last legacy classes (`.card-hover`, `.skeleton`) and `--fg-strong`.
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
| `tooltip` | **refreshed** — `Kbd` slot support | icon-button hints, replaces `title=` |
| `sonner` | kept local (our theme sync, not `next-themes`) | toasts via `lib/toast.ts` |
| `avatar` | **new** | user/candidate initials (replaces `Avatar` in `Index.tsx`, list avatars) |
| `chart` | **new** (+ `recharts` 3.8.0) | Today 14-day activity chart (R4) |
| `checkbox` | **new** | bulk-select / toggles in tables |
| `collapsible` | **new** | Sender coverage / Mailbox health disclosure panels (R2) |
| `command` | **new** (+ `cmdk` 1.1.1) | ⌘K LookupBar combobox (R3), searchable pickers |
| `dropdown-menu` | **new** | account menu (R1), row actions |
| `input-group` | **new** (dep of command) | search fields with icons (replaces absolute-positioned icons) |
| `kbd` | **new** | ⌘K / `?` shortcut hints |
| `popover` | **new** | filter popovers, combobox shell |
| `sheet` | **new** | DraftReviewPane side panel (R4) |
| `spinner` | **new** | replaces `Loader2 animate-spin` |
| `textarea` | **new** | draft body editor, dictation notes (R4) |
| `toggle`, `toggle-group` | **new** | segmented filters (draft status, reply status) |

Removed in U2a (unused): `tabs`, `pagination`, `scroll-area` and the local
`StatusBadge` (replaced by `ReplyLabelChip` / `leverChip`). Re-add with the §2
checklist if a screen needs one.

Added in R3: **`combobox`** (`ComboboxTrigger` / `ComboboxContent`) — the
trigger + popover shell for searchable pickers (Popover + Command), styled
like `SelectTrigger`; used by the Add to Lever job picker.

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

### Candidates (R3)

| Piece | File | Notes |
|---|---|---|
| Page | `components/CandidateTable.tsx` | saved views → filter bar → table → side panel |
| Row | `components/candidates/CandidateRow.tsx` | ~40px; Candidate (sticky) · Reply · Lever · Role · Mailbox · Last activity; ≤2 status chips (Role/Mailbox use the Inbox `RoleChip`/`MailboxChip`); actions on hover/focus/cursor |
| Reply label | `lib/candidates.ts` `replyLabel` | one chip: Interested / Unsure / Needs review / Not interested / No reply / Ignored (see Status vocabulary) |
| Side panel | `components/candidates/CandidateSheet.tsx` | `Sheet`; every thread, Lever, past outreach, Open in Inbox |
| Lever section | `components/lever/LeverSection.tsx` | shared with the Inbox reply pane header |
| Saved views | `components/candidates/SavedViewsBar.tsx` | 4 defaults + `/api/views?scope=candidates` |
| URL state | `hooks/useCandidateUrlState.ts` | `status reply lever q sort dir page view candidate` |
| Keyboard | `hooks/useCandidateShortcuts.ts` | ↑ ↓ ↵ Esc x only |

### Status vocabulary (U2a)

One word per candidate state, used identically by the row chip, the side
panel chip, the status filter, the row menu and the bulk bar. The source of
truth is `lib/candidates.ts` (`replyLabel`, `STATUS_OPTIONS`,
`SETTABLE_STATUSES`); `__tests__/lib/candidates.test.ts` fails if they drift.

| `Candidate.status` | Word | Tone | Meaning |
|---|---|---|---|
| `INTERESTED` | Interested | success | wants to talk |
| `NEUTRAL` | Unsure | warning | replied, but Claude classified it as neither yes nor no |
| `NEEDS_REVIEW` | Needs review | warning | a human has to read it |
| `PENDING` + a reply exists (or legacy `REPLIED`) | Needs review | warning | replied, not classified yet |
| `PENDING`, nothing from them | No reply | info | contacted, hasn't written back |
| `NOT_INTERESTED` | Not interested | destructive | declined |
| `IGNORED` | Ignored | secondary | hidden from active lists |

Never show the raw enum ("Pending", "Neutral") to a recruiter. The Inbox's
classification chip (`lib/inbox.ts` `labelFor`) uses the same words.

### Shared page pieces (U2a)

| Piece | File | Use |
|---|---|---|
| Page header | `components/shell/PageHeader.tsx` | `heading`, `description`, `actions`; the page's one `<h1>` (Candidates, Today, Settings; `srOnly` for Inbox) |
| Query error | `components/shell/QueryError.tsx` | "Couldn't load <thing>" + description + Retry, for every failed `useQuery` |
| Lever chip | `lib/leverChip.ts` `leverChip()` | label + badge variant per Lever state; table badge and side-panel section |
| Connect card | `components/shell/ConnectMailboxCard.tsx` | `context="inbox" \| "today" \| "settings"`; button label is always "Connect Gmail mailbox" |
| Age / initials | `lib/utils.ts` `formatAge`, `initials` | compact ages ("5m", "2d 4h") and avatar fallbacks |

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
| Hand-rolled UI per batch | `__tests__/design-system/hotspots.test.ts` + `scripts/design-system-audit.mjs` | **strict for R1–R4** | — |
| ESLint `no-restricted-syntax` / `no-restricted-imports` | `frontend/eslint.config.mjs`, `npm run lint:ds`, pinned by `__tests__/design-system/eslint-guard.test.ts` | **`error` app-wide** (R4 flipped it; R3 removed the Candidates warn override) | — |
| CI | `.github/workflows/test.yml` → "Design-system guard" | prints `audit:ds`; fails on any ESLint design-system error | — |

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
was mounted · `R3` = CandidateTable, `components/candidates/*`,
`components/lever/*` (the shared LeverSection), `hooks/useCandidate*`,
`lib/candidates`, LookupBar, LookupIntegrations, LeverBadge,
AddToLeverButton, AddToLeverDialog, JobCombobox, GemConnect,
GemReturnToast · `R4` = the Today page: TodayPage, components/today/*, UnmonitoredSenders. New
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
| R3 | Candidates — CandidateTable, components/candidates/*, components/lever/*, candidate hooks, lib/candidates, LookupBar, LookupIntegrations, LeverBadge, AddToLever*, JobCombobox, Gem* | 0 |
| R4 | Today — TodayPage, components/today/*, UnmonitoredSenders | 0 |
| **Total** | | **0** |

### R1 — Shell (0)

_none_

### R2 — Inbox (0)

_none_

### R3 — Candidates (0)

_none_

### R4 — Today (0)

_none_

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
