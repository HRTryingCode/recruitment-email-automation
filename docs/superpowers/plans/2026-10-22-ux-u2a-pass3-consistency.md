# U2a — UX pass 3 consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native). Steps use checkbox (`- [ ]`) syntax.

**Goal:** One vocabulary, one set of shared page/error/chip components and a lighter Settings → Mailboxes, from the third UX review (U2a items 1–20 minus inbox-owned items).

**Architecture:** Frontend only. Shared primitives (`PageHeader`, `QueryError`, `leverChip()`, `formatAge`/`initials` in `lib/utils`) land first; screens then adopt them. No inbox files (`pages/InboxPage.tsx`, `components/inbox/*`, `hooks/useInbox*.ts`, `lib/inbox.ts`) are edited — U2b owns them.

**Tech Stack:** React 18 + Vite + TanStack Query + shadcn (Tailwind 3), vitest + Testing Library.

**Spec:** the U2a batch brief (orchestrator dispatch, 2026-10-22), items 1, 2, 4–10, 14, 16, 17, 19, 20.

## Global Constraints

- Every test/build: `nice -n 19`, vitest `--maxWorkers=2`; full suite ≤ 3× locally.
- No migration; no backend change. Don't edit `components/inbox/chips.tsx` (import only) or `InboxList.tsx`.
- Settings layout edit limited to the header block (U1b adds a Notifications section to `SECTIONS`).
- Label everywhere: "Connect Gmail mailbox".
- Error component title: "Couldn't load <thing>", with Retry.

## Review Focus

- PENDING candidate who has replied (unclassified) — chip must not say "No reply"; shows "Needs review".
- Disconnect on a non-admin session — button hidden; 403 still surfaces a toast via `mailboxActionError`.
- Today tiles when every waiting view is 0 — links still land on a real view with `sort=oldest`.
- Mailbox filter hidden on /settings/* still reachable from ⌘K with the current path kept.
- Generate draft returns no id (older backend) — toast still shows; action falls back to `/inbox`.

---

### Task 1: Tokens + vocabulary (items 1, 2)
**Files:** `src/index.css`, `__tests__/design-system/contrast.test.ts`, `src/lib/candidates.ts`, `__tests__/lib/candidates.test.ts`, `docs/DESIGN-SYSTEM.md`
- [ ] Test: `--ring` / `--sidebar-ring` vs background, card ≥ 3:1 in both themes (fails today, ≈2.5:1 light).
- [ ] Light `--ring`/`--sidebar-ring` → `oklch(0.55 0.014 41.2)`; dark stays (check ≥3:1).
- [ ] Test: `replyLabel` NEEDS_REVIEW → "Needs review"/warning; NEUTRAL → "Unsure"; PENDING+inbound → "Needs review"; PENDING no inbound → "No reply". `STATUS_OPTIONS`/`SETTABLE_STATUSES` PENDING label → "No reply".
- [ ] Implement; add "Status vocabulary" table to DESIGN-SYSTEM.md. Commit.

### Task 2: Shared primitives (items 7, 8, 17)
**Files:** create `src/components/shell/PageHeader.tsx`, `src/components/shell/QueryError.tsx`; modify `src/lib/utils.ts`, `AccountMenu.tsx`, `TeamSettings.tsx`, `TodayStrip.tsx`, `LeverSection.tsx`, `lib/mailboxHealth.ts`, `MailboxesSettings.tsx`.
**Produces:** `PageHeader({ title, description?, actions?, srOnly? })` → `<header>` with `<h1>`; `QueryError({ thing, description?, onRetry, retrying? })` → destructive Alert, title `Couldn't load ${thing}`; `formatAge(ms, { withHours? })`; `initials(name?, email?)`; `HealthSummary.tone: 'success'|'warning'|'destructive'|'secondary'`.
- [ ] Tests: `__tests__/components/shell-primitives.test.tsx` (h1 + actions; QueryError title + Retry calls onRetry); `__tests__/lib/utils.test.ts` (formatAge both modes, initials); update mailboxHealth tests to semantic tones.
- [ ] Implement; use in Candidates (CandidateTable header), Today, Settings layout; QueryError in Today, Mailboxes, Integrations, Team, CandidateSheet conversation. Fix SLA comment. Commit.

### Task 3: Candidates (items 4, 9, 10)
**Files:** `CandidateSheet.tsx`, `CandidateRow.tsx`, new `src/lib/leverChip.ts`, `LeverBadge.tsx`, `LeverSection.tsx`, `lib/toast.ts`.
**Produces:** `leverChip(state: LeverState | null | undefined): { text; variant }`; `toastError(msg, desc?, action?)`.
- [ ] Tests: leverChip maps every state (same labels both consumers); Generate draft → `toastSuccess('Draft ready', …, { label: 'Review in Inbox' })` navigating to `/inbox?item=<id>`; error toast carries Retry; row shows RoleChip "Role unknown" and MailboxChip.
- [ ] Implement. Commit.

### Task 4: Settings → Mailboxes + connect label (items 5, 6, 19)
**Files:** `MailboxHealthTable.tsx`, `MailboxesSettings.tsx`, `ConnectMailboxCard.tsx`, `AppShell.tsx`, `today/MailboxTable.tsx`, `LookupBar.tsx`, `IntegrationsSettings.tsx`.
- [ ] Tests: default headers exactly Mailbox/Status/Actions; no mailbox id text until Details opened; Disconnect admin-only → AlertDialog copy mentions live updates stop + history kept → calls `deleteMailbox(id)`; ConnectMailboxCard copy per context; "Connect Gmail mailbox" label; Integrations copy "Ask an admin to connect Lever".
- [ ] Implement; delete Today unreachable empty branch. Commit.

### Task 5: Today tiles + header filter (items 14, 20)
- [ ] Tests: Oldest waiting/Expiring soon hrefs contain `sort=oldest` and an explicit `view=`; AppHeader hides MailboxFilter on /settings/*; filter wrapper `hidden sm:flex`; ⌘K "Filter by mailbox" items set `mailboxId`.
- [ ] Implement. Commit.

### Task 6: Delete leftovers (item 16)
- [ ] grep each candidate; delete StatusBadge, ui/pagination, ui/scroll-area, ui/tabs, `.card-hover`, `.skeleton`, `shimmer`, `--fg-strong`; api.ts fetchDrafts/approveDraft/discardDraft/sendDraft/fetchThreads/fetchMessages/debug*/fetchCandidateCounts/fetchHealth + tests only covering them. Keep `use-mobile.ts` (sidebar uses it), `handleAuthError` (axios interceptor), accent ramp (tailwind purple remap uses it).
- [ ] typecheck + build + full tests; screenshots; PR.
