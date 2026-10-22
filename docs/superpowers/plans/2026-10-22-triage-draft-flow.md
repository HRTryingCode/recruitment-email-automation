# Triage draft flow (H8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make "Reply as Interested / Not interested / Ignore" on a Needs-review candidate show where the result went: progress, in-place draft with a success banner, URL + rail update, list highlight, toast, Ignore with Undo, inline error with Retry.

**Architecture:** The draft mutation moves out of `CandidatePane` into a page-level hook `useTriageDraft`, so it survives the pane unmounting (the user navigates away mid-write) and can decide on success whether to swap in place (still on that candidate) or only toast. `InboxPage` keeps a `triage` record `{ draftId, view, from, stay }`. While `stay` is set and the drafted item is open, the list keeps showing the origin view (`from`) and the URL already says `?view=<new>&item=<draftId>`, so a refresh lands on the draft in its new view. "Go to Interested" clears `stay`. Backend is unchanged: a triage draft has confidence 1, so the server files INTERESTED → `interested` and NOT_INTERESTED → `not_interested`.

**Tech Stack:** React 18, TanStack Query v5, react-router v6, shadcn/ui (Alert, Skeleton, Spinner), sonner, Vitest + RTL + msw.

**Spec:** H8 brief (agent-deck dispatch, 2026-10-22). Andriy's ask: "when you click 'Reply as interested' there should be some kind of workflow so the person knows where that draft was created".

## Global Constraints
- Copy (exact): button pending label `Writing reply…`; banner title `Reply drafted · moved to Interested` / `Reply drafted · moved to Not interested`; banner detail `Hand-off to <CC first name> from <mailbox local part>@` or `Reply from <mailbox>`; actions `Review & send`, `Go to Interested` / `Go to Not interested`; toast `Draft created for <name> in Interested` with action `Open`; ignore toast `Ignored <name>` with action `Undo`.
- URL after success: `/inbox?view=<interested|not_interested>&item=<draftId>` (other params such as `mailboxId` kept).
- Use the `success` color token. No Lever/Gem calls. Never log bodies.
- Files owned: `CandidatePane.tsx`, `InboxPage.tsx`, `lib/toast.ts`; `InboxList.tsx` gets only a `highlightKey` prop (H7 is active there).
- Tests run with `nice -n 19 npx vitest run --maxWorkers=2`.

## Review Focus
1. The user opens another item while the reply is being written → no navigation away from what they're on; only the toast with `Open`. Test in Task 2.
2. The draft request fails → selection stays on the candidate, inline destructive Alert with Retry that re-sends the same classification. Test in Task 2.
3. A double click on Reply → one POST only (buttons disabled while pending). Test in Task 2.
4. Refresh after success → `?view=interested&item=<id>` reopens the draft with the Interested list. Already covered by the existing "refresh with ?item=" test plus the URL assertion in Task 2.
5. Ignore → Undo after the pane auto-advanced → unignore is called and the inbox refetches. Test in Task 3.

---

### Task 1: Success Alert variant + rail count pulse + list highlight

**Files:**
- Modify: `frontend/src/components/ui/alert.tsx` (add `success` variant: `border-success/30 bg-success/10 text-foreground [&>svg]:text-success`)
- Modify: `frontend/src/components/inbox/InboxRail.tsx`: a badge whose count changed since the last render gets `data-changed="true"` and `animate-pulse` for 1.5 s
- Modify: `frontend/src/components/inbox/InboxList.tsx`: `highlightKey?: string` prop; the matching row gets `data-highlighted="true"` and a `bg-success/10 ring-2 ring-success/40` style, and scrolls into view
- Test: `frontend/__tests__/components/inbox/TriageFlow.test.tsx` (the rail/highlight assertions live in the Task 2 flow test)

**Interfaces:** Produces `InboxList` prop `highlightKey?: string` and `Alert variant="success"`.

### Task 2: `useTriageDraft` hook + in-place draft + banner + URL/view

**Files:**
- Create: `frontend/src/hooks/useTriageDraft.ts`
- Create: `frontend/src/components/inbox/DraftedBanner.tsx`
- Modify: `frontend/src/hooks/useInboxUrlState.ts`: add `setPlace(view: InboxView, item?: string)` (replace=true)
- Modify: `frontend/src/components/inbox/CandidatePane.tsx`: takes `pending: TriageClass | null`, `error: string | null`, `onReply(c)`, `onRetry()`; shows Spinner + `Writing reply…` on the clicked button, disables all three, replaces the message area with a `role="status"` "Writing your reply…" skeleton of the draft area; error → destructive Alert `Couldn't write the reply` + error text + `Retry`
- Modify: `frontend/src/pages/InboxPage.tsx`

**Interfaces:**
- `type TriageClass = 'INTERESTED' | 'NOT_INTERESTED'`
- `useTriageDraft(opts: { currentKey: () => string | undefined; onDrafted: (r: TriageResult, inPlace: boolean) => void }) => { start(key: string, item: InboxItem, threadId: string, c: TriageClass): void; pendingFor(key): TriageClass | null; errorFor(key): string | null; retry(key): void }`
- `interface TriageResult { key: string; draft: EmailDraft; view: 'interested' | 'not_interested'; name: string; mailbox: string }`
- `viewForClass(c: TriageClass)` in `lib/inbox.ts`
- `DraftedBanner({ result, onReview, onGo, onDismiss })`

On success the hook optimistically patches every cached `['inbox', …]` page (drop the candidate item, `needs_review − 1`, `<view> + 1`), invalidates `['inbox']` and `['candidate', id]`, fires the toast with `Open` (→ `setPlace(view, draftId)` + clear stay), then calls `onDrafted(result, currentKey() === key)`. The page sets `triage` and `setPlace(view, draftId)` only when `inPlace`.

- [ ] Step 1: write failing RTL tests in `TriageFlow.test.tsx`:
  - `reply as interested: progress → in-place draft + banner → URL → Go to Interested → highlight`. Asserts: after the click the button reads `Writing reply…` and a `status` "Writing your reply…" exists; then the region `Reply to Eli Mock` shows the editor, the banner `Reply drafted · moved to Interested` + `Reply from rae@archive.com`; `search()` has `view=interested`, `item=dnew`; the rail shows `Needs review 0` and `Interested 1`; the list still shows `Needs review`; clicking `Go to Interested` shows the `Interested replies` list with row `Eli Mock` having `data-highlighted="true"`; toast `Draft created for Eli Mock in Interested` is visible.
  - `hand-off draft banner names the CC and mailbox` (draft response `ccEmail: 'sofia@archive.com'`, mailbox `paul.b@archive.com`) → `Hand-off to Sofia from paul.b@`.
  - `Review & send focuses the editor`.
  - `not interested moves to Not interested`.
  - `navigating away while writing only toasts; Open goes to the draft`.
  - `error shows inline Alert with Retry and keeps the selection`; Retry POSTs the same classification and then succeeds.
  - `double click posts once`.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement.
- [ ] Step 4: run → PASS; run the existing inbox tests → PASS.
- [ ] Step 5: commit.

### Task 3: Ignore with Undo + auto-advance

**Files:** `CandidatePane.tsx` (ignore mutation: `toastSuccess('Ignored <name>', undefined, { label: 'Undo', onClick })`; Undo → `unignoreCandidate(id)`, invalidate `['inbox']`, `toastSuccess('Restored <name>')`), `InboxPage.tsx` (`onDone` → `setItem(nextItemId(keys, itemId))`).

- [ ] Step 1: failing test `ignore toasts with Undo, advances to the next item, Undo calls unignore`.
- [ ] Step 2–4: fail → implement → pass.
- [ ] Step 5: commit; then typecheck, lint:ds, build, full frontend suite once, screenshots light/dark, PR.
