# Inbox Backend (U0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for the keyboard-first Inbox: one-step send with undo, dismiss, snooze, AI-vs-edited bodies, classifier evidence, presence + send lock, inbox queue + counts, batch send, saved views.

**Architecture:** New services hold the state machines (`draftSend.service`, `draftPresence.service`, `inbox.service`); routes stay thin (`drafts.ts` gains endpoints, new `inbox.ts`, `views.ts`). Every status transition is a compare-and-set `updateMany` so concurrent runners/users can't double-send. Delayed sends run via `waitUntil`; the 10-min sweep cron is the fallback.

**Tech Stack:** Express 4, Prisma 5 (Postgres/Supabase), zod, vitest + supertest with a mocked Prisma client, googleapis.

**Spec:** the U0 brief (agent-deck dispatch, 2026-10-22), reproduced in the PR body.

## Global Constraints

- Migration folder: `9g_inbox`; additive only; PR title flagged "REQUIRES MIGRATION AUTHORIZATION".
- Backend only; frontend changes limited to `frontend/src/lib/api.ts` types/functions.
- Every route declared in `__tests__/security/route-guards.test.ts` (requireAuth/requireAdmin).
- Never log secrets, tokens, email bodies or dismiss notes.
- Old `/approve` + `/send` (APPROVED drafts) keep working until R2 ships.
- No Lever writes. No prod DB writes.

## Decisions (locked here)

- Draft statuses: `PENDING | APPROVED (legacy) | SCHEDULED | SENDING | SENT | FAILED | DISCARDED`.
- `LIVE_DRAFT_STATUSES` = PENDING, APPROVED, SCHEDULED, SENDING, FAILED (unique-per-thread index, blocking-draft checks). FAILED is live so a failed send stays visible/retryable and no duplicate draft is generated.
- `CANCELABLE_DRAFT_STATUSES` = PENDING, APPROVED, SCHEDULED, FAILED (ignore/manual-reply supersede/dismiss). SENDING is never cancelled (in flight).
- `POST /:id/send`: APPROVED → legacy Gmail-draft path unchanged; PENDING/FAILED → schedule (new path).
- Confidence labels: high ≥ 0.85 (`DECLINE_OVERRIDE_CONFIDENCE`), medium ≥ 0.7 (`LOW_CONFIDENCE_THRESHOLD`, new export), else low.
- Inbox views: needs_review = live PENDING/APPROVED with low confidence or classification outside INTERESTED/NOT_INTERESTED (NEUTRAL included — otherwise it would be in no view), plus FAILED drafts, plus NEEDS_REVIEW candidates with no live draft (`kind:'candidate'`). snoozed = snoozedUntil > now. sent_today = SENT since ET midnight plus in-flight SCHEDULED/SENDING (so a reload during the undo window still shows undo). Live views exclude expired (>21d) and stale (H5: candidate.repliedAt > draft.createdAt) drafts.
- Snooze return: the inbox GET first runs one `updateMany` that moves past-due `snoozedUntil` to `returnedFromSnoozeAt = now`.
- Regenerate default `keepEdits` = true when the draft has edits (never silently discards). PATCH that sets bodyText back to aiBodyText clears editedAt.
- aiBodyText: no backfill (null = unknown); a backfill would label already-edited text as AI-written.
- Batch send only schedules NOT_INTERESTED PENDING drafts; others are reported as skipped.
- Lock enforced on send, undo-send, dismiss, PATCH, regenerate, dictate.

## Review Focus

1. Old waitUntil timer firing after undo + re-send → must not send early (CAS includes `scheduledSendAt <= now`). Test in Task 2.
2. Manual Gmail reply while SCHEDULED → supersede must cancel it (SCHEDULED in cancelable set). Test in Task 1.
3. Stuck SENDING (function killed mid-send) → sweep marks FAILED after 10 min with "check Gmail Sent" error, never auto-resends. Test in Task 2.
4. Own presence must never lock self; stale (>45s) editing never locks. Test in Task 4.
5. evidenceQuote with whitespace/case drift → dropped (exact substring only). Test in Task 5.

---

### Task 1: Migration, schema, status sets, mock Prisma

**Files:** Create `backend/prisma/migrations/9g_inbox/migration.sql`, `backend/src/lib/draftStatus.ts`; Modify `schema.prisma`, `gmail.service.ts` (findBlockingDraft, recordOutboundMessage, reclassifyOrphanedThreads), `candidates.ts`, `emails.ts`, `__tests__/_setup/mockPrisma.ts`.

**Produces:** `LIVE_DRAFT_STATUSES`, `CANCELABLE_DRAFT_STATUSES`, `DraftStatus` type; EmailDraft columns per spec; `DraftPresence`, `SavedView` models; mock `draftPresence`, `savedView`.

- [ ] Test `lib/draftStatus.test.ts`: live set contains SCHEDULED/SENDING/FAILED; cancelable excludes SENDING; migration SQL's live index WHERE list equals `LIVE_DRAFT_STATUSES`.
- [ ] Test: recordOutboundMessage supersede `updateMany` uses cancelable set.
- [ ] Implement; `prisma validate`; run suite; commit.

### Task 2: Gmail direct send + draftSend.service

**Files:** Create `services/draftSend.service.ts`; Modify `gmail.service.ts` (`sendMessage`), `internal-cron.ts` (sweep). Tests `services/draftSend.service.test.ts`, `services/gmail.sendMessage.test.ts`.

**Produces:**
- `sendMessage(mailboxId, input: GmailDraftInput): Promise<{ id: string; threadId: string }>` (users.messages.send, raw from buildDraftRaw, threadId).
- `executeScheduledSend(draftId, now?): Promise<'sent'|'skipped'|'failed'>`
- `runDelayedSend(draftId, delayMs): Promise<void>`
- `sweepScheduledSends(now?): Promise<{ sent; failed; skipped; interrupted }>` (SCHEDULED due > 60s; SENDING older than 10 min → FAILED)
- `undoScheduledSend(draftId): Promise<'undone'|'already_sent'|'not_scheduled'>`

Tests: raw MIME has In-Reply-To/References/Cc/threadId; two concurrent executeScheduledSend → one Gmail call; executeScheduledSend skips when scheduledSendAt in future; failure → FAILED with sanitized sendError; undo before start → PENDING, after → already_sent; sweep picks only >60s-due rows and fails stuck SENDING.

### Task 3: Send / undo / dismiss / snooze routes

**Files:** Modify `routes/drafts.ts`; Test `routes/drafts.inbox.test.ts`.

Endpoints: `POST /:id/send` (`{undoSeconds 0..30 =10, bodyText?, ccEmail?, override?}` → 202 `{data:{id,status,scheduledSendAt}}`), `POST /:id/undo-send`, `POST /:id/dismiss` (`{reason?, note? ≤500, override?}`), `POST /:id/snooze` (`{until}` future ≤30d), `POST /:id/unsnooze`. Extract PATCH edit/CC logic into `buildDraftEdits()` shared with send.

### Task 4: Presence + lock

**Files:** Create `services/draftPresence.service.ts`; Modify `drafts.ts`; Test `services/draftPresence.service.test.ts`, route tests.

**Produces:** `PRESENCE_STALE_MS = 45_000`, `heartbeatPresence`, `clearPresence`, `listPresence(draftIds, excludeUserId, now?) → Map<string, PresenceEntry[]>`, `findLockHolder(draftId, userId, now?) → {userId,name}|null`, route helper `enforceLock(req, draftId, override) → {lockedBy}|null` (logs DRAFT_LOCK_OVERRIDDEN). 423 `{success:false,error,lockedBy}`.

### Task 5: Classifier reason/evidence + AI vs edited

**Files:** Modify `claude.service.ts`, `candidateState.ts` (`LOW_CONFIDENCE_THRESHOLD`), `gmail.service.ts`, `emails.ts`, `drafts.ts` (regenerate keepEdits, PATCH edit tracking, GET adds presence/confidenceLabel/hasEdits); Create `lib/confidence.ts` (`confidenceLabel`).

Tests: reason truncated to 140; evidenceQuote kept only when exact substring ≤200; PROMPT_VERSIONS.classify bumped; regenerate keepEdits true keeps bodyText and updates aiBodyText; false replaces and clears editedAt; PATCH sets editedAt/editedByUserId.

### Task 6: Inbox queue + batch send

**Files:** Create `services/inbox.service.ts`, `routes/inbox.ts`; Modify `app.ts`, `drafts.ts` (`POST /batch-send`). Tests `routes/inbox.test.ts`.

Counts in one grouped `$queryRaw`; items via one `$queryRaw` (keyset cursor `base64(sortAtISO|kind|id)`, limit 50) then hydrated by `findMany`. Test view SQL membership via the generated SQL text + mapping, counts uses exactly one raw query, batch-send ≤50, skips locked and non-NOT_INTERESTED.

### Task 7: Saved views + api.ts + route manifest

**Files:** Create `routes/views.ts`; Modify `app.ts`, route-guards manifest, `frontend/src/lib/api.ts`. Tests `routes/views.test.ts`.

CRUD: GET (own + shared, `?scope=`), POST (`shared:true` admin only), PATCH/DELETE (own → owner; shared → admin; someone else's private → 404).

### Task 8: Verification

Backend + frontend tests, typecheck, builds; push; PR.
