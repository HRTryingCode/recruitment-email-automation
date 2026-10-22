# U2b Inbox UX pass 3 Implementation Plan

> **For agentic workers:** executed natively by the agent-deck worker (no human in the loop).

**Goal:** Ship the seven Inbox items from the third UX review (cursor ring, candidate link + ⌘K, triage keys, Hide candidate, scrollable header, one shortcuts dialog, ET-labelled snooze).

**Architecture:** Frontend only. Shortcut metadata becomes the single source in `hooks/useInboxShortcuts.ts` and `hooks/useCandidateShortcuts.ts`; `components/shell/ShortcutsDialog.tsx` renders Global/Inbox/Candidates sections and is the only `?` dialog. A tiny `lib/paletteContext.ts` store lets InboxPage publish "the current candidate" for the ⌘K palette.

**Tech Stack:** React 18, react-router, TanStack Query, shadcn/Radix, vitest + Testing Library.

**Spec:** the U2b brief (orchestrator message), items 1, 3, 11, 12, 13, 15, 18.

## Global Constraints
- `nice -n 19`, vitest `--maxWorkers=2`, ≤3 full local suite runs.
- No migration, no backend change.
- U2a (shared helpers, PageHeader) is not merged: keep local helpers, plain sr-only h1; note in PR.
- Candidates side panel URL param is `candidate` (existing), not `selected`.

## Review Focus
- I/N/D on a candidate row while a triage write is pending must not double-fire → handlers no-op when `pending`.
- I/N/D on a *draft* row must not fire (D stays Dismiss on drafts) → test.
- `?` on Inbox opens the single shell dialog (no duplicate dialog) → test.
- Snooze labels near midnight ET still say ET → existing lib tests updated.
- ⌘K "Open candidate" disappears after leaving Inbox → store cleared on unmount, test.

---

### Task 1: Cursor ring (item 1)
- Modify `components/inbox/InboxList.tsx:89` `ring-ring/40` → `ring-ring`. Test: InboxA11y asserts focused row class contains `ring-ring` and not `ring-ring/40`.

### Task 2: Hide candidate (item 12)
- `CandidatePane.tsx` footer button label "Hide candidate", wrapped in Tooltip "Hides them from Inbox and Candidates. You can undo or restore later."; toast "Hid <name>". Test: button by name, tooltip text on hover/focus.

### Task 3: Triage keys I/N/D(/S) on candidate rows (item 11)
- `InboxShortcut` gains `'interested' | 'not_interested'`; resolve `i`→interested, `n`→not_interested. CandidatePane exposes imperative actions via props from page: page lifts `ignore` into a hook `useHideCandidate(item, onDone)` used by both pane and page. On candidate rows: I/N → `triageDraft.start(...)` with the candidate's first thread (pane exposes thread via `onThread` callback? → simpler: page fetches via same `['candidate', id]` query cache with `useQuery`). D → hide. S: no snooze exists for candidate rows → not applicable (help says "drafts only").
- Tests: InboxPage candidate row: press `i` → triage POST with INTERESTED; `n` → NOT_INTERESTED; `d` → ignore call + Undo toast; on draft row `i` does nothing.

### Task 4: Candidate link + ⌘K (item 3)
- ReplyPane/CandidatePane h2 name wraps `<Link to={viewHref('/candidates', params, {candidate:id})}>`. 
- `lib/paletteContext.ts`: `setPaletteCandidate(c: {id,name}|null)`, `usePaletteCandidate()`. InboxPage sets it for the open item, clears on unmount. LookupBar adds group "Current" → "Open candidate · <name>" → go('/candidates', {candidate:id}).
- Tests: link href; palette shows item when set, not when cleared.

### Task 5: Header → scrolling body (item 13)
- ReplyPane: header keeps name/chips/email; LeverSection + Why move to top of scrolling body. Test: "Why:" not inside `header`.

### Task 6: One shortcuts dialog (item 15)
- Delete `ShortcutHelpDialog.tsx`; InboxPage `help` → `openShortcuts()`. ShortcutsDialog renders sections Global / Inbox (SHORTCUTS) / Candidates (CANDIDATE_SHORTCUTS). Tests: `?` on Inbox → one dialog with all three section headings.

### Task 7: Snooze in ET, labelled (item 18)
- Presets: "Later today · h:mm AM ET", "Tomorrow · 9am ET", "Next week · Mon 9am ET"; `formatEt(date)` in lib/inbox.ts used by StatusNotice ("Snoozed until Thu, Oct 23, 9:00 AM ET"). Tests in lib/inbox.test.ts + InboxActions labels.

### Task 8: sr-only h1 + verification
- `<h1 className="sr-only">Inbox</h1>` in InboxPage. Full frontend tests, typecheck, build, lint:ds; screenshots; PR.
