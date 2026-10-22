# U1a — Shell + Settings UX pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** First-run "connect a mailbox" onboarding, an Inbox badge that agrees with the rail, AA-safe small text, and human Settings copy.

**Architecture:** Frontend only. A shared `inboxQueryOptions(view, mailboxId)` in `lib/inboxQuery.ts` is used by both InboxPage and AppShell so the sidebar badge reads the same cached `['inbox', view, mailboxId]` query (no extra requests). A `ConnectMailboxCard` component renders the onboarding empty state in the shell (Inbox/Today routes) and Settings → Mailboxes. Contrast is fixed at the token layer in `index.css` and pinned by a jsdom-free OKLCH→sRGB contrast test.

**Tech Stack:** React 18, TanStack Query, react-router, shadcn/ui, Tailwind, Vitest + Testing Library.

**Spec:** the U1a brief (UX review pass 2, items 1–4).

## Global Constraints
- Don't edit files owned by parallel workers: InboxList.tsx, chips.tsx, CandidatePane.tsx, CandidateTable, LookupBar, LeverBadge, AddToLever*, GemConnect. InboxPage: only the query definition lines.
- `nice -n 19`, vitest `--maxWorkers=2`.
- No backend change, no migration.

## Review Focus
- Mailboxes request fails or is loading → no onboarding flash; render the route normally.
- Mailbox filter set (`mailboxId`) → badge counts that mailbox only (same key as Inbox).
- Inbox open on a non-default view → badge reuses that view's query (counts are view-independent).
- Badge sums needs_review + interested + not_interested only (not snoozed / sent_today).
- Dark mode token pairs also pass AA.

---

### Task 1: ConnectMailboxCard + shell/Settings/Today onboarding
**Files:** Create `frontend/src/components/shell/ConnectMailboxCard.tsx`; Modify `AppShell.tsx`, `pages/settings/MailboxesSettings.tsx`; Test `frontend/__tests__/shell/AppShell.test.tsx`, `__tests__/settings/MailboxesSettings.test.tsx`.
- `ConnectMailboxCard()` — Empty with title "Connect a Gmail mailbox", one-line explanation, primary button "Connect Gmail" → `startGmailReconnect()`.
- AppShell: when route is `/inbox` or `/today` and `['mailboxes']` succeeded with `[]`, render the card instead of `<Outlet/>`.
- MailboxesSettings: empty state gets the same button.
- Tests: card renders on /inbox and /today with 0 mailboxes; button calls addGmailMailbox; not rendered while loading/error/with mailboxes.

### Task 2: Badge from inbox counts
**Files:** Create `frontend/src/lib/inboxQuery.ts` (`inboxQueryOptions`, `waitingCount(counts)`); Modify AppShell, AppSidebar (prop rename `waitingCount`), InboxPage query lines.
- Tests: badge = sum of three counts; fetchInbox called once with shared key when Inbox page + shell mount; fetchDrafts not called; refetchInterval 15s.

### Task 3: Contrast
**Files:** Modify `index.css` (`--muted-foreground` light), `DraftCcSelect.tsx:74`; Create `__tests__/design-system/contrast.test.ts`.
- Test parses tokens from index.css, OKLCH→sRGB→WCAG; asserts ≥4.5 for foreground, muted-foreground, warning-on-card? (warning text is replaced, so pairs: muted-foreground on background/card/secondary/muted, foreground on secondary) for light + dark.
- DraftCcSelect warning: `text-foreground` + `text-warning` icon; test asserts no `text-warning` class on the paragraph.

### Task 4: Settings copy
**Files:** MailboxesSettings (error copy + Retry), IntegrationsSettings (Lever not configured / Add to Lever disabled explanations), TeamSettings jargon pass.
- Tests: exact strings from the brief; Retry refetches.
