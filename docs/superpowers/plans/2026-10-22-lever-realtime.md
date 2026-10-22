# Lever near-real-time status (H2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lever badge correct within seconds of a candidate being created / re-emailed, and within seconds of a Lever-side change, without faster polling.

**Architecture:** A new `services/leverRealtime.service.ts` holds (a) `scheduleLeverRefresh`, a `waitUntil` wrapper around the existing `refreshCandidateLever`, called from the two Candidate create/email-change sites; (b) Lever webhook signature verification and event processing. A new router `routes/webhooks-lever.ts` is mounted next to the Gmail webhook router. Dedupe uses a tiny `LeverWebhookEvent` table (migration `9h_lever_webhooks`). Each accepted webhook writes a `LEVER_WEBHOOK_RECEIVED` SystemLog row, surfaced in sync-health `meta` and in a watchdog warning.

**Tech Stack:** Express 4, Prisma/Postgres, vitest + supertest, `@vercel/functions` `waitUntil`, Node `crypto`.

**Spec:** orchestrator brief H2 (agent-deck dispatch, 2026-10-22) + Lever docs https://hire.lever.co/developer/documentation#webhooks.

## Global Constraints

- Branch `feat/lever-realtime`; PR to `sofiadelgado17/recruitment-email-automation` base `claude/email-automation-system-OEgcU`, title flagged "REQUIRES MIGRATION AUTHORIZATION".
- Migration folder name exactly `9h_lever_webhooks`.
- No Lever writes. Reuse `LeverClient` / `refreshCandidateLever`.
- Never log secrets, signature tokens, emails or bodies. Opportunity ids are OK to log.
- Webhook route: `POST /api/webhooks/lever`, public, declared in route-guard manifest as `signature`.
- Signature: hex HMAC-SHA256(key = signature token, msg = `token + triggeredAt`) === `signature`, constant-time; reject if `|now - triggeredAt| > 5 min`.
- Env `LEVER_WEBHOOK_SIGNATURE_TOKENS` comma-separated (trim, drop empties).
- Events handled: `applicationCreated`, `candidateStageChange`, `candidateArchiveChange`, `candidateHired`, `candidateDeleted`. Unknown → 200, ignored.
- Trust only `data.opportunityId` from the payload.
- Respond 200 before work; work in `waitUntil`.
- Watchdog: tokens set and no `LEVER_WEBHOOK_RECEIVED` in 24h → `severity: 'warning'`.
- Keep 3h `lever-sync` and H1's 15-min `lever-sync-new` untouched. Minimal edits to shared files (`leverSync.service.ts` untouched; `lever.service.ts` gains one method).

## Review Focus

1. Unconfigured env (`LEVER_WEBHOOK_SIGNATURE_TOKENS` unset) — a forged POST must not trigger work: respond 503, no processing. (Task 3 test.)
2. `LEVER_API_KEY` unset — `scheduleLeverRefresh` must not write `ERROR unconfigured` onto fresh rows; it no-ops. (Task 2 test.)
3. `candidateDeleted` — opportunity 404s in Lever; candidate must still be found by `leverOpportunityId` and refreshed (likely becomes NOT_FOUND). (Task 4 test.)
4. Malformed body (missing `triggeredAt`, non-numeric, `data` missing) → 400/401, never throws 500. (Task 3 test.)
5. Dedupe table write failing for a non-duplicate reason (DB blip) → still process (fail open on dedupe, refresh is idempotent). (Task 4 test.)

---

### Task 1: Migration + schema + mock

**Files:**
- Create: `backend/prisma/migrations/9h_lever_webhooks/migration.sql`
- Modify: `backend/prisma/schema.prisma` (new model)
- Modify: `backend/__tests__/_setup/mockPrisma.ts` (add `leverWebhookEvent: create | deleteMany`)

**Produces:** `prisma.leverWebhookEvent` with fields `id String @id` (dedupe key), `event String`, `opportunityId String?`, `triggeredAt DateTime`, `createdAt DateTime @default(now())`, `@@index([createdAt])`.

- [ ] Write SQL (CREATE TABLE + index, header comment "REQUIRES MIGRATION AUTHORIZATION"), model, mock entry.
- [ ] `npx prisma generate` and `npx vitest run __tests__/prisma` pass.

### Task 2: scheduleLeverRefresh + create / email-change hooks

**Files:**
- Create: `backend/src/services/leverRealtime.service.ts`
- Modify: `backend/src/services/gmail.service.ts` (after `candidate.upsert` in `classifyAndDraft`, when `!existingCandidate`)
- Modify: `backend/src/routes/candidates.ts` (PATCH: when normalized email differs from `current.email.toLowerCase()`, after the update succeeds, both return paths)
- Test: `backend/__tests__/services/leverRealtime.schedule.test.ts`, additions to `gmail.classify.test.ts` and `candidates.test.ts`

**Produces:** `scheduleLeverRefresh(candidateId: string, reason: 'created' | 'email_changed', deps?: { refresh?, client? }): void`

Triage (`POST /api/emails/threads/:id/draft`) never creates a Candidate (it requires `thread.candidate`), so it needs no hook.

- [ ] Tests: calls `waitUntil` once with a promise that runs `refreshCandidateLever(id, client)`; a rejected refresh is swallowed and logs `LEVER_REFRESH_FAILED` (WARN, `{candidateId, reason, error}`); unconfigured client → no `waitUntil`, no refresh. gmail: new candidate → scheduled with `'created'`; existing → not scheduled. PATCH: email change → scheduled `'email_changed'`; same email (case-only) or no email → not.
- [ ] Implement; run tests green.

### Task 3: Signature verification + route

**Files:**
- Modify: `backend/src/services/leverRealtime.service.ts`
- Create: `backend/src/routes/webhooks-lever.ts`
- Modify: `backend/src/app.ts` (`app.use('/api/webhooks', webhooksRouter, leverWebhookRouter)`)
- Modify: `backend/__tests__/security/route-guards.test.ts` (Guard `'signature'`, `'POST /api/webhooks/lever': 'signature'`)
- Test: `backend/__tests__/services/leverRealtime.signature.test.ts`, `backend/__tests__/routes/webhooks-lever.test.ts`

**Produces:**
- `parseSignatureTokens(raw: string | undefined): string[]`
- `verifyLeverSignature(body: {token?, triggeredAt?, signature?}, tokens: string[], now?: number): { ok: true } | { ok: false; reason: 'missing_fields' | 'stale' | 'bad_signature' }`
- `LEVER_WEBHOOK_EVENTS: ReadonlySet<string>`
- `LEVER_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000`

Route behaviour: tokens empty → 503; verify fails → 401 (sampled `LEVER_WEBHOOK_REJECTED` WARN, ≤1/min); unknown event → 200 `{ignored:true}`; missing `data.opportunityId` → 200 `{ignored:true}`; else 200 then `waitUntil(processLeverWebhook(...))`, errors → `LEVER_WEBHOOK_ERROR`.

- [ ] Signature tests: valid; wrong token; tampered triggeredAt; stale (6 min old); future (6 min ahead); second of two tokens matches; missing fields; signature of a different length doesn't throw.
- [ ] Route tests: 503 unconfigured; 401 bad sig; 200 + no waitUntil for unknown event; 200 + waitUntil for each of the 5 events with `{event, opportunityId, triggeredAt, dedupeKey}`.
- [ ] Route-guard manifest updated; implement; green.

### Task 4: processLeverWebhook

**Files:**
- Modify: `backend/src/services/leverRealtime.service.ts`
- Modify: `backend/src/services/lever.service.ts` (add `getOpportunityEmails(id: string): Promise<string[] | null>` — GET `/opportunities/:id`, returns lowercased `data.emails`; null on any error incl. 404)
- Test: `backend/__tests__/services/leverRealtime.process.test.ts`, addition to `lever.service.test.ts`

**Produces:** `processLeverWebhook(evt: { event: string; opportunityId: string; triggeredAt: number; dedupeKey: string }, client?): Promise<{ duplicate: boolean; candidateIds: string[] }>`

Algorithm: insert `leverWebhookEvent` (P2002 → `{duplicate:true}`, other errors → continue); log `LEVER_WEBHOOK_RECEIVED` `{event, opportunityId}`; candidates = `leverOpportunityId = opportunityId` ∪ (emails from `getOpportunityEmails`, case-insensitive `email in`) — max 10; `refreshCandidateLever(id, client)` each, sequentially. Dedupe key = `body.id` if string, else `${event}:${opportunityId}:${triggeredAt}`.

- [ ] Tests: each of the 5 events refreshes the candidate matched by opportunity id; match by email when no stored opp id; union without duplicates; `candidateDeleted` with 404 → still refreshes by stored opp id; duplicate → no refresh; dedupe DB error → still refreshes; no match → `candidateIds: []`.
- [ ] Implement; green.

### Task 5: Observability + docs

**Files:**
- Modify: `backend/src/services/monitoring.service.ts` (`HealthIssueType` += `'lever_webhook_silent'`; `WATCHDOG_THRESHOLDS.leverWebhookSilentMs = 24h`; in `collectHealthIssues`, when tokens set, `systemLog.findFirst({ event: 'LEVER_WEBHOOK_RECEIVED', createdAt >= now-24h })` null → warning)
- Modify: `backend/src/routes/internal-status.ts` (sync-health response gains `meta: { leverWebhooksLast24h, lastLeverWebhookAt }`, via `systemLog.count` + `findFirst`, failures → nulls)
- (Pruning `LeverWebhookEvent` deferred: retention deletes are human-gated and the table is tiny.)
- Modify: `docs/OPERATIONS.md` ("Lever webhooks" section, env table row, sync-health meta, watchdog row)
- Test: `monitoring.service` test, `internal-status.test.ts`

- [ ] Tests: warning when tokens set + no row; none when unset; none when a row exists. Sync-health meta present and counts.
- [ ] Implement + docs; full backend + frontend test/typecheck/build green; commit; push; PR.
