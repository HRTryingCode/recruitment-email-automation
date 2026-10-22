# R1 — Taupe theme + shadcn app shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the purple brand at the token layer, replace the top-tab layout with a shadcn Sidebar shell on URL routes (/inbox, /candidates, /today, /settings/*), move mailbox admin to Settings, add a global reconnect banner and a ⌘K command palette, and drive the R1 design-system area to zero findings (strict).

**Architecture:** Tokens: legacy Tailwind colour names (`accent-*`, `fg-*`, `surface-*`, `line`, `ink-*`) are re-pointed in `tailwind.config.ts` at the shadcn taupe CSS variables, so R2–R4 screens turn taupe without edits; new `success`/`warning`/`info` tokens. Shell: `AppShell` (layout route under `ProtectedRoute`) = shadcn `Sidebar` + header + `StatusBanner` + `<Outlet/>`. All view state lives in URL search params via a small `lib/urlState.ts`; legacy `/?tab=` URLs are translated by a pure `legacyRedirect()`.

**Tech Stack:** React 18, react-router-dom 6, TanStack Query 5, Tailwind 3.4 + shadcn (luma/taupe, `tailwind.shadcn-compat.ts`), cmdk, Vitest + Testing Library, Playwright (screenshots only).

**Spec:** the R1 batch brief (Andriy, 2026-10-22) + `docs/DESIGN-SYSTEM.md` §3–§7.

## Global Constraints

- FULL TAUPE: no purple anywhere. Primary = preset taupe `--primary`. green = interested/ok (`success`), amber = unsure/needs review/warning (`warning`), red = not interested/error (`destructive`), neutral taupe otherwise.
- Only `@/components/ui/*` primitives in R1 files; no direct Radix imports outside ui/; colours via tokens only; no ad-hoc radius/shadow/z/arbitrary values; lucide icons only.
- New shadcn components via the DESIGN-SYSTEM §2 checklist (never `shadcn init/apply`; keep converted pre-existing ui files; run tw4→tw3 codemod; `tw3-dead-classes` = 0; remove the `cn` dep if added).
- Frontend only. No migration. Don't touch `AddToLever*`, `Gem*` internals beyond mounting `GemConnect`, `LeverBadge`.
- `/` → `/inbox`. Legacy `?tab=dashboard|drafts|candidates&filter&q&draftId&candidateId` → new routes with those params preserved.
- Banner copy: `"<local-part>@ needs reconnecting · Reconnect"`; many issues → one banner with a count; dismissible per session (sessionStorage).

## Review Focus

1. Legacy URL with `?mailbox=connected` / `?gem=...` OAuth callback params (backend redirects to `/?mailbox=connected`) — toast must still fire after the redirect to /inbox. Test in Task 3.
2. Switching views clears view-scoped params (`filter`, `q`, `draftId`, `candidateId`) but keeps `mailbox` — the "filter/q never cleared" bug. Test in Task 3.
3. Banner when sync-health 403s/errors for non-admins → render nothing, no crash. Test in Task 5.
4. Dark mode `bg-accent-500 text-white` buttons in R2–R4 screens must stay legible (accent ramp 500–700 maps to a mid taupe in dark). Covered by token test in Task 1.
5. ⌘K still works while focus is inside an input; `?` must NOT open help while typing. Test in Task 6.

---

### Task 1: Taupe tokens

**Files:** Modify `frontend/tailwind.config.ts`, `frontend/src/index.css`. Test: `frontend/__tests__/design-system/theme-tokens.test.ts`.

- [ ] Test: resolve the Tailwind config (`resolveConfig`) and assert no colour value in `theme.colors.accent`, `boxShadow` contains a hex or a purple `--accent-500` RGB reference; every `accent.<n>` is an `oklch(from var(--…))` token expression; `success`, `warning`, `info` (+ `foreground`) exist. Parse `index.css` and assert none of the old purple triplets (`124 92 245`, `109 64 230`, `178 154 248`, `138 91 247`, `92 64 200`, `79 41 184`) remain, and `--success`/`--warning`/`--info` are defined in `:root` and `.dark`.
- [ ] Implement: `--accent-50…900` CSS vars defined per mode as `var(--primary)`/`var(--muted-foreground)`/`var(--secondary)` etc. (light: 300–900 → primary; dark: 50–400 → foreground/primary, 500–700 → mid taupe `oklch(0.438 0.017 39.3)`, 800–900 → `--secondary`). Legacy `fg/surface/line/ink` re-pointed to shadcn vars. `shadow-glow`/`card-hover` → neutral. Body: plain `bg-background` (drop radial glows), `:focus-visible` outline → `--ring`. Remove `.card/.card-hover/.hairline/.grid-bg` only if no remaining users (R2–R4 still use `.skeleton` → keep, recoloured).
- [ ] Run vitest, commit.

### Task 2: shadcn Sidebar component

- [ ] `npx shadcn@4.22.1 add sidebar` per §2 checklist; restore overwritten ui files; codemod; `tw3-dead-classes` 0; existing `tw3-classes.test.ts` passes. Commit.

### Task 3: Routing, URL state, legacy redirects

**Files:** Create `src/lib/urlState.ts`, `src/lib/legacyRedirect.ts`, `src/components/shell/AppShell.tsx`, `src/components/shell/AppSidebar.tsx`, `src/components/shell/AppHeader.tsx`, `src/components/shell/useOAuthCallbackToasts.ts`, `src/pages/{InboxPage,CandidatesPage,TodayPage}.tsx`; modify `App.tsx`, `MailboxFilter.tsx` (shadcn Select), `ThemeToggle.tsx` (Button); delete `pages/Index.tsx`. Test: `__tests__/shell/routing.test.tsx`, `__tests__/lib/legacyRedirect.test.ts`, `__tests__/lib/urlState.test.ts`.

**Interfaces:**
- `legacyRedirect(search: string): string | null` — returns new path+search for `/` with legacy params, e.g. `?tab=drafts&draftId=d1` → `/inbox?draftId=d1`; `?tab=candidates&filter=AWAITING_REPLY&q=x` → `/candidates?filter=AWAITING_REPLY&q=x`; `?tab=dashboard` or none → `/today`… no: none → `/inbox`; dashboard → `/today`. Non-tab params (`mailbox`, `reason`, `gem`, `mailboxId`) carried over.
- `VIEW_PARAMS = ['filter','q','draftId','candidateId','sort','dir','status','view']`; `navigateToView(path, current: URLSearchParams, extra?) → string` keeps only `mailboxId` (global) + `extra`.
- `useMailboxFilter(): [string|undefined, (id?: string) => void]` backed by `?mailboxId=`.
- Tests: legacy cases above; sidebar click Inbox→Candidates drops `q`/`filter` and keeps `mailboxId`; `/` renders Inbox; unknown route → NotFound; OAuth `?mailbox=connected` toast fires.

### Task 4: Settings area

**Files:** `src/pages/settings/{SettingsLayout,MailboxesSettings,IntegrationsSettings,TeamSettings}.tsx`, `src/components/settings/{MailboxHealthTable,ResyncAllButton,SignaturePreviewDialog}.tsx`; rewrite `UnmonitoredSenders.tsx` with shadcn; strip health accordion, ResyncAll, debug box and UnmonitoredSenders from `Dashboard.tsx` (keep HealthPill, link to /settings/mailboxes). Tests: `__tests__/settings/*.test.tsx` (move the accordion cases from Dashboard.test).
- Resync spinner = `useMutation.isPending` for that row; errors via `extractApiErrorMessage` (specific); copy "Try again from Settings → Mailboxes".
- Integrations: `GemConnect` + `fetchLeverMe()` (configured / create enabled, read-only Badges).
- Team: `fetchDraftCcOptions()` minus "No CC" → admins table; hidden on error.

### Task 5: Global status banner

**Files:** `src/components/shell/StatusBanner.tsx`, `src/lib/statusBanner.ts`. Test `__tests__/shell/StatusBanner.test.tsx`.
- `bannerIssues(rows: MailboxSyncHealth[]): {mailboxId,emailAddress}[]` = rows where `mailboxHealthState === 'reconnect'`.
- One issue: "aaronrampersad@ needs reconnecting" + Reconnect button (starts `addGmailMailbox` flow). N>1: "N mailboxes need reconnecting" + Reconnect (first) + "Details" link to /settings/mailboxes. Dismiss → sessionStorage key `statusBanner:dismissed:<sorted ids>`; reappears if the set changes.

### Task 6: ⌘K command palette + shortcuts dialog

**Files:** rewrite `src/components/LookupBar.tsx` on `ui/command` inside `CommandDialog`; `src/components/shell/ShortcutsDialog.tsx`. Update `__tests__/components/LookupBar.test.tsx` (new URLs `/inbox?draftId=`, `/candidates?q=`). New tests: palette lists Navigation (Go to Inbox/Candidates/Today/Settings), Actions (Toggle theme, Reconnect <mailbox>, Show shortcuts); selecting "Go to Candidates" navigates; `?` opens help, not while typing.

### Task 7: Login / NotFound / ProtectedRoute → shadcn; R1 strict

- [ ] Convert; `node scripts/design-system-audit.mjs` R1 = 0; add `'R1'` to `STRICT_AREAS`; `--write-docs`; update DESIGN-SYSTEM.md §3 (brand decision = full taupe, success/warning/info tokens), §4 (sidebar added).

### Task 8: Verify + screenshots + PR

- [ ] `npm test`, `npx tsc --noEmit`, `npm run build` (frontend), backend tests; extend `docs/screenshots/capture.mjs` for new routes (light/dark × 1280/390), before (base) / after into `docs/screenshots/r1/`; push to `fork`, PR to origin.
