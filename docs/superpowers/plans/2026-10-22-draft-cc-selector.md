# Draft CC Selector (F4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a recruiter change a draft's CC from the default (sofia@archive.com) to any other admin, or to no one, from the draft review pane, with hand-off bodies re-naming the person looped in.

**Architecture:** An additive nullable `EmailDraft.ccEmail` column holds the CC each draft was created with (`NULL` = legacy, use the computed default; `''` = explicitly no CC). A small service resolves CC options and effective CC; a pure lib owns the pronoun-free loop-in sentence and its deterministic re-render. PATCH /api/drafts/:id accepts `ccEmail`, rewrites the loop-in line and syncs an existing Gmail draft. The frontend swaps the read-only CC line for a shadcn Select.

**Tech Stack:** Express + Prisma + zod + vitest/supertest (backend); React + TanStack Query + Radix/shadcn Select + sonner + RTL/vitest (frontend).

**Spec:** the F4 brief (orchestrator dispatch message), summarised in Global Constraints.

## Global Constraints

- Migration folder `backend/prisma/migrations/9e_draft_cc`, additive only: `ALTER TABLE "EmailDraft" ADD COLUMN "ccEmail" TEXT;` No backfill.
- Options = env `DRAFT_CC_OPTIONS` (recruitment team; scope change 2026-10-22 — NOT admins/ADMIN_EMAILS), fallback `[config.draftCcEmail]`, lowercased, deduped; name = `User.name` → `Mailbox.displayName` → local-part; firstName = first token. Plus a "No CC" option (`email: null`).
- Never CC the mailbox owner — evaluated against the selected CC.
- `ccEmail` changes allowed only on PENDING or APPROVED (unsent) drafts; APPROVED drafts accept `ccEmail` only (no body/subject edits). Invalid address → 400.
- Loop-in phrasing is pronoun-free: `I'm looping in {Name} from the recruitment team here, who will …`. Never " she" / " he ".
- Route guard: everything under `/api/drafts` is behind `requireAuth` at mount.
- No logging of email bodies or tokens. No Lever calls.

## Review Focus

- Claude paraphrases the loop-in despite the instruction → re-render can't find it → UI must show the manual-update warning, never corrupt the body. (Task 4 test: edited sentence.)
- Legacy drafts (ccEmail NULL, old "— she'll" phrasing) → effective CC = computed default; CC change still rewrites old-style sentences. (Task 1 legacy-pattern test, Task 4 null-ccEmail test.)
- Selecting the mailbox owner as CC via API → 400. (Task 4.)
- APPROVED draft whose Gmail draft was deleted in Gmail → CC change succeeds and clears `externalDraftId` so send re-creates it. (Task 4.)
- Select keyboard use (arrows/Enter/Esc) inside the listbox must not trigger j/k/Enter/Esc draft shortcuts. (Task 6 hook test.)

---

### Task 1: Loop-in sentence lib (pure)

**Files:** Create `backend/src/lib/handoffLoopIn.ts`; Test `backend/__tests__/lib/handoffLoopIn.test.ts`

**Produces:**
- `loopInSentence(type: HandoffType, ccName: string): string`
  - coordinator: `I'm looping in ${n} from the recruitment team here, who will schedule time with you and share more about the position.`
  - sofia_interviews: `I'm looping in ${n} from the recruitment team here, who will be interviewing you and will get some time on the calendar.`
  - ethan_interviews_sofia_schedules: `I'm looping in ${n} from the recruitment team here, who will coordinate timing for the interview.`
- `replaceLoopIn(text: string, newName: string): { text: string; replaced: boolean }` — finds the first current-format sentence (any name) or a legacy one (old template / old Claude phrasing incl. `(email) — she'll…`) and replaces it with `loopInSentence(sameType, newName)`.

- [ ] Tests: each type round-trips (build with "Sofia", replace with "Ethan" → equals `loopInSentence(type,'Ethan')` in place, rest of body unchanged); legacy template + legacy Claude sentences are replaced; edited sentence → `replaced:false`, text identical; no generated sentence matches `/\b(she|he|her|his)\b/i`.
- [ ] Run fail → implement → pass → commit.

### Task 2: CC options + effective CC service

**Files:** Create `backend/src/services/draftCc.service.ts`; Test `backend/__tests__/services/draftCc.service.test.ts`

**Produces:**
- `NO_CC = ''`
- `interface CcOption { email: string; name: string; firstName: string }`
- `listCcOptions(opts?: { excludeEmail?: string }): Promise<CcOption[]>` (sorted by name)
- `ccFirstName(email: string): Promise<string>`
- `resolveDraftCc(stored: string | null | undefined, ownerEmail: string): string | null` — null/undefined → `draftCcAddressFor` logic (config default, owner-excluded); `''` → null; else stored unless it equals owner.

- [ ] Tests: exactly DRAFT_CC_OPTIONS (an admin like ethan@ not offered), fallback to default, case-insensitive dedupe; name precedence User.name > Mailbox.displayName > local-part; excludeEmail drops owner; resolveDraftCc cases (null legacy, '', owner, other).
- [ ] Fail → implement → pass → commit.

### Task 3: Migration + MIME uses stored CC + hand-off generation

**Files:** Modify `backend/prisma/schema.prisma` (EmailDraft `ccEmail String?`), create `backend/prisma/migrations/9e_draft_cc/migration.sql`; modify `backend/src/services/gmail.service.ts` (createDraft, new `updateDraft`, `draftCcAddressFor` delegates, `buildHandoffDraftContent` + `composeHandoffDraftContent` use `loopInSentence`/`ccFirstName`, accept `ccEmail` option; createLiveDraft callers store `ccEmail`), `backend/src/services/claude.service.ts` (`handoffInstruction` → `loopInSentence`, "verbatim", bump `PROMPT_VERSIONS.handoff`), `backend/src/routes/emails.ts` (store ccEmail on create).

**Produces:** `createDraft(mailboxId, { …, ccEmail?: string | null })`, `updateDraft(mailboxId, externalDraftId, sameDraftShape): Promise<void>` (gmail.users.drafts.update).

- [ ] Tests (drafts.mime.test.ts): approve with stored `ccEmail: 'ethan@archive.com'` → raw has `Cc: ethan@archive.com`, not sofia; stored `''` → no Cc header; stored = owner → no Cc. emails.draft.test: new draft stores `ccEmail`; fallback template is pronoun-free.
- [ ] Fail → implement → pass → commit.

### Task 4: Routes — cc-options + PATCH ccEmail

**Files:** Modify `backend/src/routes/drafts.ts`; Test `backend/__tests__/routes/drafts.cc.test.ts`

- `GET /api/drafts/cc-options?draftId=` (declared before `/:id`) → `{ success, data: [{email:null,name:'No CC',firstName:null}, ...CcOption[]] }`, owner of draftId's mailbox excluded.
- PATCH `ccEmail` (string | null): validation/state rules per Global Constraints; hand-off draft (handoff inbox + INTERESTED) gets `replaceLoopIn`; bodyHtml re-rendered via `composeDraftHtml`; APPROVED with externalDraftId → `updateDraft` first (404 → clear externalDraftId; other → 502, no DB write). Response `data` includes `ccAddress`; plus `ccChange: { ccAddress: string|null; loopIn: 'updated'|'not_found'|'not_handoff'; handoffWithoutCc: boolean }`.
- List/detail serve `ccAddress = resolveDraftCc(draft.ccEmail, owner)`.

- [ ] Tests: options union/owner-exclusion via route; PATCH 400 unknown email, 400 owner, 400 SENT/DISCARDED, 400 APPROVED+bodyText, 200 APPROVED ccOnly calls Gmail drafts.update with new Cc in raw; loop-in rewritten for each type; edited sentence → `loopIn:'not_found'`, body untouched; null on hand-off → `handoffWithoutCc:true`; route-guard test still green.
- [ ] Fail → implement → pass → commit.

### Task 5: Frontend Select + api

**Files:** Create `frontend/src/components/ui/select.tsx` (shadcn), `frontend/src/components/DraftCcSelect.tsx`; modify `frontend/src/lib/api.ts` (`CcOption`, `fetchDraftCcOptions`, `updateDraft` accepts `ccEmail`, `EmailDraft.ccEmail`), `frontend/src/lib/toast.ts` (`toastWarning`), `DraftReviewPane.tsx` (prop `onChangeCc(id, ccEmail|null)`), `EmailDrafts.tsx` (ccMutation: optimistic ccAddress, merge server body, toasts "CC changed to {firstName}" / "CC removed", warning toasts for `not_found` / `handoffWithoutCc`, rollback on error). Test `frontend/__tests__/components/DraftCcSelect.test.tsx` + EmailDrafts integration.

- [ ] Tests: changing option calls onChange with email; "No CC" → null; disabled when status SENT; inline warning when No CC selected and body contains "looping in"; EmailDrafts: change → updateDraft called with `{ccEmail}` and toast text.
- [ ] Fail → implement → pass → commit.

### Task 6: Shortcut isolation

**Files:** Modify `frontend/src/hooks/useDraftKeyboardShortcuts.ts`; test in a new `frontend/__tests__/hooks/useDraftKeyboardShortcuts.test.ts`.

- [ ] Test: keydown `j`/`Escape`/`Enter` with target inside `[role="listbox"]` or `[role="combobox"]` → no handler fires.
- [ ] Fail → implement → pass → commit.

### Task 7: Verification + PR

- [ ] `npm test`, typecheck, build in backend and frontend; push to `fork`; PR flagged REQUIRES MIGRATION AUTHORIZATION.
