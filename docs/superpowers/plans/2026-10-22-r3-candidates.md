# R3 Candidates Implementation Plan

> **For agentic workers:** executed natively by the R3 agent-deck worker (TDD per task). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild the Candidates page as one-line shadcn rows with a side panel, bulk actions, saved views and URL state; bring every R3 design-system file to zero findings and make R3 strict.

**Architecture:** Pure helpers (`lib/candidates.ts`: reply label, filter⇄URL mapping, default views, sort params) drive a thin page made of focused components under `components/candidates/`. The Inbox's `LeverSection` moves to `components/lever/LeverSection.tsx` and is shared by the Inbox reply pane, the candidate side panel and the ⌘K lookup card. Backend gains a bulk endpoint, `mailbox`/`lever`/`lastActivity` sort columns, and search that ANDs with filters.

**Tech Stack:** React 18, react-router 6 search params, TanStack Query 5, shadcn/ui (Sheet, Table, Checkbox, DropdownMenu, Select, InputGroup, ToggleGroup, Dialog), Express + Prisma + zod, vitest.

**Spec:** the R3 brief (Andriy-approved UX) pasted into this worker session; `docs/DESIGN-SYSTEM.md` §5 rules.

## Global Constraints

- Every test/build command: `nice -n 19`, vitest `--maxWorkers=2`, ≤3 full-suite loops locally.
- No migration. No prod writes. No new Lever writes (reuse AddToLeverButton/Dialog/prefetchAddToLever).
- Do not edit Dashboard / Today files (R4).
- Every new backend route declared in `backend/__tests__/security/route-guards.test.ts` MANIFEST.
- Row ≈40px, one line; ≤2 chips per row (reply label + Lever).
- Keyboard on Candidates: only ↑ ↓ ↵ Esc x.
- Label words: Interested / Unsure / Not interested (+ "No reply" when they never wrote, "Ignored").

## Review Focus

1. Search typed while a filter is active → both apply, filter chip stays visible and removable (backend no longer drops filters on search).
2. Legacy deep links `?filter=AWAITING_REPLY|NEEDS_REVIEW` (Today page, R4) and `?q=` keep working.
3. Selected-candidate param pointing at a candidate not on the current page → panel still opens (detail fetched by id).
4. Bulk Ignore across rows discards live drafts like the single ignore (server transaction).
5. Shortcuts don't fire while typing in search or when a menu/dialog/sheet has focus.

---

### Task 1: Backend — bulk, sort columns, search + filters

**Files:** Modify `backend/src/routes/candidates.ts`, `backend/__tests__/security/route-guards.test.ts`; Test `backend/__tests__/routes/candidates.r3.test.ts`

- [ ] Tests: `search keeps status/lever/replyStatus filters`; `search without status hides IGNORED unless includeIgnored`; `sort=mailbox orders by mailbox.emailAddress`; `sort=lever orders by leverPostingTitle then leverState`; `sort=lastActivity pages a globally sorted id list (greatest of lastInboundAt/lastOutboundAt, fallback updatedAt)`; `POST /bulk status=INTERESTED → updateMany`; `POST /bulk status=IGNORED → $transaction(updateMany candidates + discard drafts)`; `POST /bulk rejects >200 ids / bad status (400)`.
- [ ] Implement; add `'POST /api/candidates/bulk': 'auth'` to MANIFEST. Commit.

### Task 2: Pure helpers — `frontend/src/lib/candidates.ts`

- `replyLabel(c: Candidate): { text: 'Interested'|'Unsure'|'Not interested'|'No reply'|'Ignored'; tone: 'success'|'warning'|'destructive'|'info'|'secondary' }`
- `type CandidateFilters = { status?: string; reply?: 'AWAITING_REPLY'; lever?: 'IN'|'NOT_IN'; q?: string; sort?: SortKey; dir?: 'asc'|'desc' }`
- `filtersFromParams(p: URLSearchParams): CandidateFilters` (maps legacy `filter=`), `filtersToApi(f, page, mailboxId)`, `DEFAULT_VIEWS` (all_active, awaiting, interested_not_in_lever, needs_review), `sameFilters(a,b)`, `activeFilterChips(f)`, `lastActivity(c)`.
- [ ] Tests in `frontend/__tests__/lib/candidates.test.ts` for each mapping. Commit.

### Task 3: Shared Lever UI + R3 inventory to zero

- Move `components/inbox/LeverSection.tsx` → `components/lever/LeverSection.tsx` (also invalidates `['candidates']`); inbox imports it.
- `LeverBadge` → `Badge` variants + `Tooltip` (no title=, no palette/legacy); `AddToLeverButton` → `Button` (`variant="outline" size="xs"`), Tooltip for disabled reason; `AddToLeverDialog` → Spinner/Skeleton/Alert warning; `GemConnect` → Button + tokens; `JobCombobox` → new `ui/combobox.tsx` (`ComboboxTrigger`, `ComboboxContent`); `LookupIntegrations` tokens; LookupBar card shows LeverSection-style panel for unknown emails and "Open" → `/candidates?candidate=<id>`.
- [ ] Update LeverBadge/AddToLever/GemConnect/LookupBar tests deliberately (titles → tooltips). Commit.

### Task 4: Candidates page

**Files:** `components/CandidateTable.tsx` (page shell), `components/candidates/{CandidateRow,CandidateSheet,SavedViewsBar,FilterBar,BulkBar,RowActions}.tsx`, `hooks/useCandidateUrlState.ts`, `hooks/useCandidateShortcuts.ts`, `lib/api.ts` (`bulkUpdateCandidates`), `lib/urlState.ts` (`reply`, `candidate` view params).

- [ ] Tests (`__tests__/components/CandidateTable.test.tsx` rewritten + `CandidateSheet.test.tsx`, `SavedViewsBar.test.tsx`, `hooks/useCandidateShortcuts.test.tsx`): columns & chips; sort header → `sort/dir` in URL and API; filter chips removable; search + filter both sent; saved view select/save/update/delete; bulk select + Ignore/status; side panel shows all threads, Lever section, past outreach, Open in Inbox; keyboard ↑↓↵Esc x.
- [ ] Implement, enable `STRICT_AREAS` R3, regenerate §7, commit.

### Task 5: Verification + screenshots + PR

- [ ] `docs/screenshots/r3/capture-candidates.mjs` (light/dark × 1440/1024/390: table, hover actions, side panel, bulk bar, saved views, lookup card).
- [ ] Backend + frontend suites, typecheck, build, lint:ds; push to `fork`, PR to origin.
