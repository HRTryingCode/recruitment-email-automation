# Add to Lever dialog UX (H3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Andriy's feedback on AddToLeverDialog: one Job combobox, theme-correct inputs in dark mode, in-dialog Gem connect (popup) that fills empty fields, honest résumé chip.

**Architecture:** Frontend only. Root cause of the grey inputs is the Tailwind colour wiring `oklch(from var(--x) l c h / <alpha-value>)`, which discards the token's own alpha (dark `--input` is `oklch(1 0 0 / 15%)`, so `bg-input/50` = 50% white); switch to `calc(alpha * <alpha-value>)`. The Gem OAuth callback already redirects to the SPA with `?gem=connected|error|denied`; a tiny boot-time handler relays that to the opener (postMessage + BroadcastChannel) and closes the popup, or cleans the URL and toasts in the full-page flow.

**Tech Stack:** React 18, TanStack Query 5, shadcn (radix-luma) Popover + Command (cmdk), Vitest + RTL, Playwright for screenshots.

**Spec:** the H3 brief (Andriy's 4 feedback points) — copied into the PR body.

## Global Constraints

- No migration, no new Lever endpoints, Add to Lever create flow (payload, idempotency key) unchanged.
- Empty state copy: "No open jobs match". Callout copy: "Connect Gem to fill in LinkedIn, title, location and résumé"; buttons "Connect Gem" / "Reconnect Gem"; muted "Not found in Gem"; chips "Filled from Gem"; résumé chip "From Gem: <file name>" else "No résumé".
- Poll `/api/integrations/gem/status` every 2s for up to 2 min while the popup is open.
- Gem refill fills EMPTY fields only.
- No hand-styled inputs in the dialog (shadcn Input/Select/Command only).

## Review Focus

- Popup blocked (window.open returns null) → fall back to full-page redirect, not a dead button.
- User types into LinkedIn while popup is open → refill must not overwrite it (test: type, then connect, assert typed value kept).
- Popup closed without connecting → polling stops at 2 min / on close, button re-enabled.
- `?gem=` landing in a normal tab (account-menu flow) → app still renders, param removed, toast shown.
- Suggested job not among open postings → nothing preselected, required validation still blocks submit.

---

### Task 1: Token alpha fix
**Files:** Modify `frontend/tailwind.config.ts` (shadcn colour entries).
- [ ] Replace `/ <alpha-value>)` with `/ calc(alpha * <alpha-value>))` for every `oklch(from var(--…)` entry. Verify with `npm run build` and a Playwright dark screenshot.

### Task 2: Popover + Command components
- [ ] `npx shadcn@4.22.1 add popover command` in `frontend`; commit generated files + cmdk dep.

### Task 3: Gem popup connect
**Files:** Create `frontend/src/lib/gemOAuth.ts`, test `frontend/src/lib/gemOAuth.test.ts`; modify `frontend/src/main.tsx`, `GemConnect.tsx`.
**Produces:** `handleGemOAuthReturn(win?: Window): 'relayed' | 'handled' | null` (boot handler); `openGemConnectPopup(opts): Promise<'popup' | 'redirect'>`; hook `useGemPopupConnect({ onConnected }): { connect(), connecting, error }`.
- [ ] Tests: return handler posts `{type:'gem-oauth', result}` to opener with own origin and closes; with no opener strips `gem` from URL and returns result; hook resolves on message, on BroadcastChannel, on status poll = OK; stops after 2 min; blocked popup → redirect.

### Task 4: Dialog rewrite
**Files:** Create `frontend/src/components/JobCombobox.tsx`; modify `AddToLeverDialog.tsx`; test `frontend/src/components/AddToLeverDialog.test.tsx`.
- [ ] Tests: one combobox (no "Search jobs" input), suggested preselected with "Suggested" hint, typing filters, grouped by team with location, keyboard select (ArrowDown+Enter), "No open jobs match"; callout NOT_CONNECTED → Connect → refetched prefill fills only empty fields + "Filled from Gem" chips; NOT_FOUND muted text; NEEDS_REAUTH → "Reconnect Gem"; résumé chip filename.

### Task 5: Verify
- [ ] Backend + frontend tests, `npm run build` both, Playwright screenshots dark/light before/after (mocked API), PR.
