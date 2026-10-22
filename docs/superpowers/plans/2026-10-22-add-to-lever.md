# F3 Add to Lever — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Recruiters add a candidate who isn't in Lever (or add them to another job) from the app, with the job picked by them, stage defaulting to "Interest Call", the clicker as owner, and Gem data (via GeMCP) prefilling the form.

**Architecture:** A Lever *write* client (`leverWrite.service.ts`) sits beside the read-only `lever.service.ts` and reuses its token bucket. A Gem MCP client (`gem.service.ts`) does per-user OAuth 2.1 (discovery, DCR, PKCE through `@modelcontextprotocol/sdk/client/auth.js`), stores encrypted tokens in `GemConnection`, and calls the read-only tools `search`/`get_person` with a 10s timeout and defensive shape checks. `addToLever.service.ts` builds the prefill and runs the create (re-validate, dedupe on posting, perform_as, multipart résumé, note, refresh, SystemLog, idempotency). Routes live in `routes/lever.ts` (postings/me), `routes/candidate-lever.ts` (candidate prefill/create), `routes/lookup.ts` (email prefill/create), and `routes/integrations-gem.ts` plus a public callback in app.ts.

**Tech Stack:** Express 4 + Prisma 5 + zod + vitest/supertest; React 18 + react-query + Radix/shadcn + RTL; `@modelcontextprotocol/sdk@1.32.1` (exact pin, published 2026-10-05).

**Spec:** the F3 brief from the orchestrator (pasted in the session), with the facts verified there.

## Global Constraints
- Migration folder `9f_add_to_lever`; additive only; PR title flagged "REQUIRES MIGRATION AUTHORIZATION".
- No real Lever/Gem calls in tests; fake fetch / in-process fake MCP server only.
- `LEVER_CREATE_ENABLED === 'true'`, otherwise 403 "Add to Lever is turned off".
- No Lever user for the clicker: 409 "Your Lever account wasn't found for <email>".
- Never log tokens, email bodies or résumé bytes. SystemLog `LEVER_OPPORTUNITY_CREATED` holds `{actorUserId, candidateId, opportunityId, postingId}` only.
- Every new route gets a MANIFEST entry in route-guards.test.ts.
- Gem is read-only (only the `search` and `get_person` tools), 10s timeout, degrade to "Gem unavailable — paste LinkedIn manually".

## Review Focus
1. Double-click Confirm: same idempotencyKey within 10 min returns the first result (in-flight promise shared, too). Test in Task 4.
2. Gem returns an unexpected shape (missing fields, non-JSON text): prefill still works and `gem.status` is 'UNAVAILABLE'. Test in Task 2.
3. A posting that is closed or unknown: 400 "That job is no longer open in Lever". Test in Task 4.
4. A presigned résumé URL that 403s or is too large (>10MB): fall back to a JSON create without the résumé, not a failure. Test in Task 4.
5. An expired Gem token with a failing refresh: the connection flips to NEEDS_REAUTH, prefill degrades, and status reports NEEDS_REAUTH. Test in Task 2.

---

### Task 1: Migration + Lever write client
**Files:** `prisma/migrations/9f_add_to_lever/migration.sql`, `prisma/schema.prisma`, `src/services/leverWrite.service.ts`, `__tests__/services/leverWrite.service.test.ts`, `__tests__/_setup/mockPrisma.ts` (add gemConnection).
**Produces:** `class LeverWriteClient({apiKey?, fetchImpl?, rateLimiter?, timeoutMs?})` with `listOpenPostings(): Promise<LeverPosting[]>` (state=published and state=internal, distributionChannel public+internal, paginated), `findUserByEmail(email): Promise<{id,name,email}|null>`, `listStages(): Promise<{id,text}[]>`, `createOpportunity(input: CreateOpportunityInput, performAs: string): Promise<{id: string}>` (JSON or multipart when `input.resume` = `{filename, contentType, data: Uint8Array}`; multipart sets `parse=true`), `addNote(oppId, text, performAs): Promise<void>`. Errors are `LeverWriteError {status, message}` with readable messages for 4xx.
- [ ] Tests: JSON payload (one posting, owner === perform_as, origin 'sourced'), multipart includes `emails[]`, `postings[]`, `resumeFile`, and `parse=true`, notes body `{value}`, 400 maps Lever's `message`, posting pagination and merge, user lookup.
- [ ] Implement, run tests, commit.

### Task 2: Gem MCP client + connection store
**Files:** `src/services/gem.service.ts`, `src/lib/gemOAuth.ts`, `__tests__/services/gem.service.test.ts`.
**Produces:** `buildGemAuthUrl(userId): Promise<string>`, `completeGemAuth(code, userId): Promise<void>`, `gemStatus(userId)`, `disconnectGem(userId)`, `getGemAccessToken(userId)` (refreshes when expiring within 60s, sets NEEDS_REAUTH on failure), `lookupGemPerson(userId, email, opts?): Promise<GemLookup>`, where `GemLookup = {status:'FOUND'|'NOT_FOUND'|'NOT_CONNECTED'|'NEEDS_REAUTH'|'UNAVAILABLE', person?: GemPerson, message?}` and `GemPerson = {name, title, company, location, phone, linkedinUrl, resumeUrl, resumeFilename}`.
- [ ] Tests against an in-process McpServer (InMemoryTransport): happy path, shape change leads to UNAVAILABLE, timeout leads to UNAVAILABLE, and a failed refresh leads to NEEDS_REAUTH.
- [ ] Implement, run tests, commit.

### Task 3: Gem routes + OAuth callback
**Files:** `src/routes/integrations-gem.ts`, `src/app.ts`, `__tests__/routes/integrations-gem.test.ts`, route-guards manifest.
- [ ] Tests: connect redirects with a bound state; the callback rejects bad or expired state and stores tokens for the state's user; DELETE; status.
- [ ] Implement, commit.

### Task 4: Prefill + create service and routes
**Files:** `src/services/addToLever.service.ts`, `src/routes/lever.ts` (GET /api/lever/postings, GET /api/lever/me), `src/routes/candidate-lever.ts`, `src/routes/lookup.ts`, tests.
**Produces:** `suggestPosting(role, postings)`, `buildPrefill(...)`, `createInLever(...)`.
- [ ] Tests: role-to-posting suggestion, flag off gives 403, no Lever user gives 409, duplicate on the same posting gives 409 with a link, idempotency, closed posting gives 400, résumé fetch failure falls back to JSON, SystemLog has ids only.
- [ ] Implement, commit.

### Task 5: Frontend
**Files:** `src/lib/leverApi.ts`, `src/components/AddToLeverDialog.tsx`, `src/components/AddToLeverButton.tsx`, `src/components/GemConnect.tsx`; wire into LeverBadge/CandidateTable/LookupIntegrations/Dashboard; RTL tests.
- [ ] RTL: suggested job preselected, stage default Interest Call, confirm text "Add <name> to <job>", existing-opportunity warning, flag-off button disabled with a tooltip, name required for unknown email.
- [ ] Implement, commit.

### Task 6: Verify + PR
- [ ] Backend test/typecheck/build, frontend test/build, push to `fork`, open the PR against origin.
