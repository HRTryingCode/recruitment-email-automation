# U1b — Inbox UX pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the second UX review's Inbox items (1, 2, 4, 5, 9, 10, 12, 16, 17, 19, 20, 21, 22): pagination + virtualization, dismiss undo, failed-send and new-reply alerts, rewrite undo, ⌘Z while typing, row/pane flags, perf, a11y, copy.

**Architecture:** One small backend change (POST /api/drafts/:id/undismiss; `editedByName` + `expiresAt` on inbox items and GET /drafts/:id, no migration). Frontend: `useInfiniteQuery` for the list, `@tanstack/react-virtual` above a row threshold, new focused hooks (`useNewReplyAlerts`, `useSendWatch`, `useLiveAnnouncer`) and an `OpenReply` container that owns editor state so typing doesn't re-render the page or list.

**Tech Stack:** Express + Prisma + zod + vitest/supertest (backend); React 18, TanStack Query v5, @tanstack/react-virtual 3.14.13, sonner, vitest + RTL + msw (frontend).

**Spec:** The U1b brief (items 1–22 above, line refs re-located on main 10c793c).

## Global Constraints

- Every test/build command prefixed `nice -n 19`; vitest `--maxWorkers=2`; full suites ≤ 3× locally.
- No migration (no new columns). Every new route declared in `backend/__tests__/security/route-guards.test.ts`.
- Never log email bodies, tokens or secrets; candidate PII only in authenticated responses.
- Don't touch AppShell / settings files (U1a) or Candidates/LookupBar (R3). The browser-notification opt-in lives in the Inbox rail for now.
- Copy pinned by the spec: "Send failed", "Back from snooze", "Edited by X", "Expires in 2d", "(N) Inbox", "2 new replies", "Undo rewrite", "Sent to Ana. Opened Ben."

## Review Focus

1. Polling an infinite query re-fetches every loaded page; an item shifting across a page boundary must not render twice (dedupe by itemKey) → test in Task 4.
2. New-reply alert must not fire for the recruiter's own undo/undismiss/unsnooze or a mailbox/role switch → test in Task 6.
3. Undismiss when the thread already has another live draft → 409, not a unique-index 500 → test in Task 1.
4. ⌘Z inside a dirty editor must still be the textarea's own undo, not undo-send → test in Task 8.
5. Group by role with more than one page must show every role's items once all pages load → test in Task 4.

---

### Task 1: Backend — undismiss route + editedByName/expiresAt

**Files:**
- Modify: `backend/src/routes/drafts.ts` (after `/:id/dismiss`; GET `/:id`)
- Modify: `backend/src/services/inbox.service.ts` (`InboxDraftSummary`, item mapping)
- Test: `backend/__tests__/routes/drafts.inbox.test.ts`, `backend/__tests__/routes/inbox.test.ts`, `backend/__tests__/security/route-guards.test.ts`

**Interfaces:** Produces `POST /api/drafts/:id/undismiss` → `{ success, data: { id, status: 'PENDING' } }`; `InboxDraftSummary.editedByName: string | null`, `InboxDraftSummary.expiresAt: Date | null` (createdAt + DRAFT_EXPIRY_DAYS for PENDING/APPROVED, else null); GET /drafts/:id adds `editedByName`, `expiresAt`.

- [ ] Tests: undismiss DISCARDED+dismissedByUserId → PENDING, clears dismissReason/dismissNote/dismissedByUserId/externalDraftId, logs DRAFT_UNDISMISSED; 409 when not DISCARDED; 409 when DISCARDED without dismissedByUserId (expired/ignored, not via dismiss); 409 when thread has another live draft; 404 unknown; P2002 race → 409. Inbox: `editedByName` resolved from User.name (fallback email), `expiresAt` set for PENDING only. Route guard entry `'POST /api/drafts/:id/undismiss': 'auth'`.
- [ ] Run, see fail; implement; run, see pass; commit.

### Task 2: lib/inbox.ts pure helpers + api.ts

**Files:** `frontend/src/lib/inbox.ts`, `frontend/src/lib/api.ts`; tests `frontend/__tests__/lib/inbox.test.ts`

**Interfaces (produces):**
- `VIEWS[].hint: string` (per-view empty description).
- `sendLine(mailbox, cc)` → `"Sending as X · CC Y"` (no Lever).
- `lockWarning(actionLabel: string): string` → "Sending now may overwrite their changes." / "Dismissing now…" (first word + ing, dropping trailing e).
- `expiresIn(expiresAt: string | null | undefined, now: number): string | null` → "Expires in 2d" / "Expires in 5h" / "Expires today"? — returns text only when ≤ 3 days left and > 0, else null.
- `mergePages(pages: InboxItem[][]): InboxItem[]` — concat, dedupe by itemKey (first wins). (`itemKey` moves to lib/inbox.ts; InboxList re-exports.)
- `newReplyDelta(prev: Counts | null, next: Counts): number` — sum over needs_review+interested+not_interested, positive delta else 0.
- `liveSummary(done: string, opened?: string): string` → "Sent to Ana. Opened Ben." / "Sent to Ana."
- api.ts: `undismissDraft(id)`, `InboxItem.draft.editedByName/expiresAt`, `EmailDraft.editedByName`.

- [ ] Tests with exact strings above; fail; implement; pass; commit.

### Task 3: Row flags (items 4, 12) — `DraftFlags`

**Files:** Create `frontend/src/components/inbox/DraftFlags.tsx`; modify `InboxList.tsx` Row, `ReplyPane.tsx` header. Test `frontend/__tests__/components/inbox/DraftFlags.test.tsx`.

**Interfaces:** `DraftFlags({ flags: { status, sendError, returnedFromSnoozeAt, hasEdits, editedByName, expiresAt } })` renders: destructive Badge "Send failed" (title = sendError) when FAILED; dot + "Back from snooze" when returnedFromSnoozeAt; "Edited by {firstName}" when hasEdits && editedByName; `expiresIn(...)` badge.

- [ ] Tests per flag + none rendered for a plain draft; implement; commit.

### Task 4: Pagination + virtualization (item 1, 16)

**Files:** Create `frontend/src/hooks/useInboxList.ts`; modify `InboxPage.tsx`, `InboxList.tsx`; add dep `@tanstack/react-virtual@3.14.13`. Tests `frontend/__tests__/components/inbox/InboxPagination.test.tsx`; fixture `installInbox` gains `pageSize` option returning `nextCursor`.

**Interfaces:** `useInboxList({ view, mailboxId, sort, roles, grouped })` → `{ items, counts, roleCounts, isLoading, isError, refetch, hasNextPage, isFetchingNextPage, fetchNextPage }`. queryKey stays `['inbox', view, mailboxId ?? null, sort, roles]`. When `grouped`, auto-fetches remaining pages up to `MAX_GROUPED_PAGES = 10`. InboxList gets `hasMore`, `loadingMore`, `onLoadMore`; renders a sentinel (IntersectionObserver when available) + "Load more" button. Rows virtualize when row count > `VIRTUALIZE_AFTER = 100`. Row and InboxList are `memo`; Row takes `onOpen(key)` / `onCheck(id, checked)` (stable).

- [ ] Tests: second page loads on "Load more" and items append; duplicate item across pages renders once; grouped view fetches all pages and shows a role only on page 2; ↓ at the last loaded row fetches the next page. Implement; commit.

### Task 5: Undismiss + Undo on dismiss toast (item 2)

**Files:** `useInboxActions.ts` dismiss; tests in `InboxActions.test.tsx`; fixture handler for `/undismiss`.
- [ ] Test: Dismiss → toast "Dismissed" with Undo → POST /d1/undismiss → toast "Back in the inbox" and item reopens. Implement (`undismiss(id)`, mirrors `undo`); commit.

### Task 6: New-reply alerts (item 5)

**Files:** Create `frontend/src/hooks/useNewReplyAlerts.ts`, `frontend/src/components/inbox/DesktopAlertsToggle.tsx` (rendered in InboxRail footer). Test `frontend/__tests__/hooks/useNewReplyAlerts.test.tsx`.

**Interfaces:** `useNewReplyAlerts(counts | undefined, scope: string): { resync: () => void }`. On delta>0: toast "1 new reply"/"N new replies", unseen += delta, `document.title = "(N) Inbox"`; on `visibilitychange` visible+focus resets unseen and title to "Inbox"; scope change or `resync()` resets the baseline without alerting. If `document.hidden` and `Notification.permission === 'granted'` and localStorage `inbox.desktopAlerts === '1'` → `new Notification(...)`. Restores the original title on unmount.
- [ ] Tests: delta toast + title; no alert on first load, scope change or after resync; desktop Notification only when granted+enabled+hidden. Implement; wire `resync` into useInboxActions via `onLocalChange`; commit.

### Task 7: Failed-send watch (item 4)

**Files:** Create `frontend/src/hooks/useSendWatch.ts`; modify `useInboxActions.ts` (send/batchSend call `watch`). Test `frontend/__tests__/hooks/useSendWatch.test.tsx`.

**Interfaces:** `useSendWatch(onOpen: (id: string) => void): { watch: (sends: Array<{ id: string; name: string }>) => void }`. Polls `fetchDraft` for watched ids every `SEND_WATCH_MS = 5000` until SENT / PENDING / DISCARDED or `SEND_WATCH_TIMEOUT_MS = 180_000`; on FAILED → `toastError('Send to {name} failed', sendError)` with action Open → onOpen(id) and invalidate ['inbox'].
- [ ] Tests: FAILED → error toast with Open that opens the draft; SENT → no toast, polling stops. Implement; commit.

### Task 8: OpenReply container, rewrite undo, ⌘Z, lock copy, a11y (items 9, 10, 16, 17, 19)

**Files:** Create `frontend/src/components/inbox/OpenReply.tsx` (owns `useDraftEditor`, `useDraftPresence`, send/edit shortcuts, ReplyPane props); modify `InboxPage.tsx`, `ReplyPane.tsx`, `useInboxActions.ts`, `useInboxShortcuts.ts`; create `frontend/src/hooks/useLiveAnnouncer.tsx`. Tests in `InboxActions.test.tsx`, `useInboxShortcuts.test.tsx`.

**Interfaces:**
- `useInboxShortcuts(handlers, enabled, allowWhileTyping?: (id) => boolean)`.
- `useInboxActions` options add `nameOf(key) => string | undefined`, `announce(msg)`, `onLocalChange()`, `onSendWatch(...)`; returns `undismiss`, `undoRewrite`, `rewriteUndo: { draftId; previous; rewritten } | null`, `canUndoLast(): boolean`.
- Rewrite/regenerate (non-kept) capture `previous = body`; toast "Rewritten" action "Undo rewrite"; ReplyPane shows an "Undo rewrite" button while `editor.body === rewritten`. Undo PATCHes `bodyText: previous` and adopts it.
- After a send, blur the focused editor; ⌘Z allowed while typing when `canUndoLast() && !editorDirty`.
- `LockedAlert` uses `lockWarning(lock.actionLabel)`.
- Pane h2 `tabIndex={-1}` focused (preventScroll) when the draft id changes and focus isn't already inside the pane. Polite live region announces `liveSummary(...)` after send/dismiss/snooze.
- [ ] Tests: Undo rewrite restores previous body; ⌘Z with focus in a clean editor undoes the send, in a dirty editor doesn't; locked dismiss says "Dismissing now may overwrite"; live region reads "Sent to Ada Example. Opened Ben Sample."; h2 focused on open. Implement; commit.

### Task 9: Enter default cursor + empty hints (items 20, 21)

**Files:** `InboxPage.tsx`, `InboxList.tsx`; tests `InboxActions.test.tsx`, `InboxPage.test.tsx`.
- [ ] Tests: ↵ with nothing focused opens the first reply; first row shows the focus ring by default; ↓ then ↵ opens the second; empty Snoozed view shows its hint. Implement; commit.

### Task 10: Verify + ship
- [ ] `nice -n 19` backend + frontend tests (`--maxWorkers=2`), `tsc`, builds, `lint:ds`. Screenshots light/dark via dev server + Playwright (kill after). Push to `fork`, open PR.
