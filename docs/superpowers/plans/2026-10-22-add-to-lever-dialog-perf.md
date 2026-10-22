# H5 — Add to Lever dialog performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Add to Lever dialog opens in <300ms on app data; Gem enrichment streams in after; repeat opens are instant.

**Architecture:** Split `GET .../lever/prefill` (app data + cached Lever columns) from a new `GET .../lever/prefill/gem` (Gem only, served from Candidate gem* cache columns when fresh, refreshed in `waitUntil` when stale). Gem MCP lookups reuse a per-instance client, single-flight token refresh, run `get_person` calls in parallel with an 8s per-call timeout, and report step timings into `GEM_PREFILL`. The frontend fires both queries in parallel (prefetched on hover/focus/row expand) and fills only empty fields when Gem lands.

**Tech Stack:** Express + Prisma (Postgres), `@modelcontextprotocol/sdk`, `@vercel/functions` waitUntil, React + @tanstack/react-query v5, vitest.

**Spec:** H5 brief (orchestrator message, 2026-10-22) — quoted in the PR body.

## Global Constraints

- Migration name `9i_gem_cache`; additive, nullable columns only: `gemPersonId`, `gemTitle`, `gemCompany`, `gemLocation`, `gemFetchedAt`, `gemResumeAvailable`.
- Gem cache fresh if `gemFetchedAt` < 7 days (FOUND). NOT_FOUND cached for 24h (deviation: Gem adds people after first contact).
- Lever existing-opportunity data from cached `lever*` columns when `leverCheckedAt` < 1h; otherwise the live `findByEmail` (as today). No new Lever call types.
- Never store résumé files or presigned URLs; never log tokens, email bodies or candidate PII (GEM_PREFILL logs outcome/timings/field booleans only).
- MCP per-call timeout 8s; token refreshed when <60s left; background enrichment ≤2 concurrent per instance.
- react-query: Gem query staleTime 10 min (0 for NOT_CONNECTED/NEEDS_REAUTH/UNAVAILABLE so connecting Gem takes effect), app prefill staleTime 1 min.
- Every new route declared in `backend/__tests__/security/route-guards.test.ts` MANIFEST as `auth`.

## Review Focus

1. Two concurrent lookups for one user with an expiring token (hover prefetch + open, or background enrichment) — must refresh once, not race Gem's rotating refresh token into NEEDS_REAUTH. → Task 2 test "concurrent lookups share one refresh".
2. A reused MCP client whose session died (Gem restart / 401) — must evict and not poison later lookups. → Task 2 test "a failed lookup evicts the cached client".
3. Recruiter types into LinkedIn while Gem is loading, then Gem arrives — typed value must win. → Task 5 test "fills empty fields only".
4. Recruiter confirms before Gem arrives — create sends `includeResume: false` and the UI says the résumé was not attached. → Task 5 test "Confirm enabled during Gem load".
5. Cached Gem data for a user who is not connected to Gem — show cached fields but keep the Connect callout and no résumé. → Task 3 test "cache hit for a not-connected user".

---

### Task 1: Migration + schema

**Files:** Create `backend/prisma/migrations/9i_gem_cache/migration.sql`; Modify `backend/prisma/schema.prisma` (Candidate).

- [ ] Add the six nullable columns (`gemResumeAvailable Boolean?`, `gemFetchedAt DateTime?`, rest `String?`), `prisma generate`, migration-order test passes. Commit.

### Task 2: Faster, instrumented Gem lookup (`gem.service.ts`)

**Interfaces — Produces:**
- `GemPerson.id: string | null` (Gem ext_id).
- `GemTimings { tokenMs; tokenRefreshMs; mcpConnectMs; searchMs; getPersonMs; totalMs; cold: boolean; clientReused: boolean }`; `GemLookup.timings?: GemTimings`.
- `lookupGemPerson(userId, email, deps & { extId?: string })` — with `extId`, skips `search`.
- `__resetGemClientCache()`.

Tests (`backend/__tests__/services/gem.service.test.ts`): second lookup reuses the client (transportFactory called once, `timings.clientReused`); a token change opens a new client; a failed lookup evicts the cached client; token with 30s left is refreshed before the call; concurrent lookups share one refresh (token endpoint hit once); `get_person` for 3 results runs in parallel (fake tool with 50ms delay, total < 120ms); a hung tool call times out at `callTimeoutMs`; `extId` path skips search; timings present.

### Task 3: Split prefill + Gem cache + timings (`addToLever.service.ts`, routes)

**Interfaces — Produces:**
- `buildPrefill(args) → { prefill: LeverPrefill, timings: { dbMs, leverExistingMs, postingsMs, totalMs } }`; `LeverPrefill` loses gem-derived values (location/phone null, linkedinUrl stored only, headline from app title/company, `resume`/`gem` removed).
- `buildGemPrefill({ actorUserId, email, candidate }) → LeverGemPrefill { status, message?, source: 'live'|'cache'|'cache_stale'|'none', fetchedAt: string|null, name, headline, location, phone, linkedinUrl, resume: { available, source, filename } }`.
- `persistGemEnrichment(candidateId, lookup)`; `gemCacheState(candidate) → 'fresh'|'stale'|'missing'`.
- Routes: `GET /api/candidates/:id/lever/prefill/gem`, `GET /api/lookup/lever-prefill/gem?email=`; prefill responses carry a `Server-Timing` header; GEM_PREFILL details gain timings + `source`.
- Create: résumé lookup passes the cached `gemPersonId` as `extId`.

Tests (`backend/__tests__/routes/addToLever.test.ts`): prefill never calls Gem; prefill uses cached lever columns <1h (reader not called) and calls live when stale; gem endpoint: miss → live + persisted; fresh cache → no Gem call; stale → cached returned + background refresh scheduled; cache hit for a not-connected user; unknown email → live, nothing persisted; GEM_PREFILL contains timings, no PII.

### Task 4: Background enrichment on new Candidate (`gemEnrichment.service.ts`)

**Interfaces — Produces:** `scheduleGemEnrichment(candidateId, reason: 'created'|'stale', opts?: { userId? })`, `pickGemUserFor(candidateId) → string|null`, `__resetGemEnrichmentState()`. Hooked in `gmail.service.ts` beside `scheduleLeverRefresh(candidate.id, 'created')`.

Tests (`backend/__tests__/services/gemEnrichment.test.ts`): prefers mailbox-owner user with OK connection; falls back to an admin with OK; none → no lookup; ≤2 concurrent; errors swallowed. `gmail.classify.test.ts`: new candidate schedules enrichment.

### Task 5: Frontend split dialog + prefetch

**Interfaces — Produces (`frontend/src/lib/leverApi.ts`):** `fetchLeverGemPrefill(target)`, `leverPrefillQueryOptions(target)`, `leverGemQueryOptions(target)`, `leverPostingsQueryOptions`, `prefetchAddToLever(queryClient, target)`, type `LeverGemPrefill`.

Dialog opens on app prefill + postings; "Fetching from Gem…" skeleton chips on LinkedIn/headline/location/résumé; Gem fills empty fields only; Confirm enabled while Gem loads; résumé badge states (fetching / will attach / not attached because Gem still loading). `AddToLeverButton` prefetches on hover/focus; `CandidateTable` prefetches on row expand.

Tests (`frontend/__tests__/components/AddToLever.test.tsx`): dialog renders form before Gem resolves; fills empty only; Confirm enabled during Gem load and sends `includeResume: false`; hover prefetches both.

### Task 6: Verify + PR

All backend/frontend suites, typecheck, builds; local timing run against the fake MCP; PR flagged REQUIRES MIGRATION AUTHORIZATION.
