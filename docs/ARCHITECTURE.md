# Architecture

This document is the per-module narrative companion to the prose summary in
[the README](../README.md). It assumes you've read the high-level diagram
there.

## Repository layout

```
recruitment-email-automation/
├── api/index.ts                 # Vercel serverless entry — re-exports backend/src/app.ts
├── backend/
│   ├── prisma/                  # Schema + migrations
│   └── src/
│       ├── app.ts               # Express app — routes, middleware, OAuth callback
│       ├── index.ts             # Local dev entrypoint (listen on PORT)
│       ├── config.ts            # Env-var loader + validation
│       ├── db/                  # Prisma client, seed script
│       ├── lib/                 # crypto (AES-256-GCM), oauthState (CSRF protection)
│       ├── middleware/          # requireAuth, error
│       ├── routes/              # Express routers (one per resource)
│       └── services/            # Domain logic — gmail, claude, auth, email, monitoring
├── frontend/                    # React + Vite + Tailwind
├── vercel.json                  # Build cmds, function bundling, cron schedule, rewrites
└── package.json                 # npm workspaces (backend + frontend)
```

## Backend modules

### `backend/src/routes/*`

Each file owns one URL prefix. All `/api/*` routes pass through Helmet, CORS,
and a 500-req/15-min rate limiter declared in `backend/src/app.ts`. Auth-gated
routers are mounted behind `requireAuth`.

| File | Mounted at | Auth | What it owns |
|---|---|---|---|
| `auth.ts` | `/api/auth` | Public | Email/password signup + login, Google Sign-In ID-token verification (`@archive.com` only), JWT issuance, `GET /me`. |
| `mailboxes.ts` | `/api/mailboxes` | JWT | List/connect/delete mailboxes, kick off Gmail OAuth, force resync, Workspace-service-account connect. The unauthenticated `GET /api/mailboxes/gmail/callback` is split out in `app.ts` because the Google redirect doesn't carry a JWT. |
| `candidates.ts` | `/api/candidates` | JWT | List/get/update candidates, ignore/unignore (sets `status=IGNORED` and discards stale drafts). |
| `emails.ts` | `/api/emails` | JWT | List threads and messages — paginated, filter by mailbox or candidate. |
| `drafts.ts` | `/api/drafts` | JWT | List/get pending drafts, edit body, **regenerate** (per-draft + bulk), **approve** (creates Gmail draft with CC), **send**, **discard**. |
| `webhooks.ts` | `/api/webhooks` | Public | `POST /gmail` — Pub/Sub push target. Acknowledges 200 immediately and processes asynchronously. |
| `internal-cron.ts` | `/api/internal/cron` | `CRON_SECRET` | `POST /renew-watches` (every 6h) and `POST /reconcile` (every hour). |
| `internal-status.ts` | `/api/internal/sync-health` | JWT | Per-mailbox sync-health snapshot — watch expiry, last synced message, pending drafts, reconciliation results. |
| `health.ts` | `/api/health` | Public | `GET /` — DB connectivity probe used as Vercel/uptime check. Returns 503 if unhealthy. |

### `backend/src/services/*`

Stateless modules; the route layer is thin and delegates here.

- **`gmail.service.ts`** — the biggest module. Owns OAuth URL generation, the OAuth-callback handler, credential encryption (`serializeCredentials`/decrypt round-trip), `watchMailbox` (calls `gmail.users.watch`), `processWebhook` (decodes the Pub/Sub envelope, dispatches to `fetchAndStoreMessage`), `syncMessages` (history-based catch-up), `createDraft`/`sendDraft` (creates the Gmail draft message with the Sofia CC and sends it), `renewGmailWatches`, and `reconcileMailbox`.
- **`claude.service.ts`** — single `Anthropic` client. Two entry points: `classifyReply` (returns `{classification, confidence}` — INTERESTED / NOT_INTERESTED / NEUTRAL / etc.) and `generateDraftReply` (returns the body of the recommended reply). Both prompts inject Archive's communication style and the original thread context.
- **`auth.service.ts`** — `bcrypt` password hashing and `jwt.sign`/`jwt.verify` helpers. Token TTL is 7 days.
- **`email.service.ts`** — provider-abstraction shim. Today it dispatches to `gmail.service` for `provider === 'GMAIL'`; an `OUTLOOK` branch is stubbed out but unwired.
- **`monitoring.service.ts`** — `logEvent` writes structured rows to `SystemLog` (safe-stringified — see commit `99c268a`). `checkHealth` is what `/api/health` consults.

### `backend/src/lib/*`

- **`crypto.ts`** — `encrypt(plaintext)` and `decrypt(ciphertext)`. AES-256-GCM with a 12-byte random IV and the 16-byte auth tag, all base64-packed into a single `iv:tag:ciphertext` string. Key is `process.env.ENCRYPTION_KEY` (base64, 32 bytes).
- **`oauthState.ts`** — in-memory CSRF nonce store for the Gmail OAuth handshake. `storeOAuthState(state)` before redirecting the user; `consumeOAuthState(state)` in the callback. Entries expire on a short TTL.

### `backend/src/middleware/*`

- **`requireAuth.ts`** — extracts `Authorization: Bearer <jwt>`, verifies via `auth.service`, attaches `req.user`. Rejects 401 otherwise.
- **`error.ts`** — `createError(message, status)` helper plus the terminal Express error handler. Logs to `SystemLog` for 5xx and returns a JSON envelope.

### `backend/prisma/schema.prisma`

Seven models. Brief description of each:

- **`User`** — App user (a recruiter or admin who logs into the dashboard). Holds the Google ID, email, optional password hash for the legacy email/password path.
- **`Mailbox`** — A connected Gmail account. Stores the AES-256-GCM-encrypted OAuth credentials, the current `lastHistoryId` (cursor for `gmail.users.history.list`), and `watchExpiry` (so the renewal cron knows when to re-`watch`).
- **`Candidate`** — A unique outbound recipient identified by email. Holds the AI-derived `status` (PENDING / INTERESTED / NOT_INTERESTED / NEUTRAL / REPLIED / IGNORED) and a link to the mailbox that owns the relationship.
- **`EmailThread`** — Gmail thread, scoped by `(mailboxId, externalThreadId)`. The unit of work for classification — drafts attach to a thread, not a single message.
- **`EmailMessage`** — Individual Gmail message inside a thread. Stores headers, body text/HTML, the original `externalMessageId`, and `receivedAt`.
- **`EmailDraft`** — AI-generated reply. Holds the proposed body, the classification + confidence that produced it, the in-reply-to/References headers needed for proper threading, and a lifecycle `status` (PENDING → APPROVED → SENT, or DISCARDED, or regenerated in-place).
- **`SystemLog`** — Append-only audit/observability log. `level` is INFO / WARN / ERROR; `event` is a short string key and `details` is a JSON blob.

## Data flows

### 1. Mailbox connect

```
User clicks "Connect Gmail" in dashboard
    │
    ▼
Frontend POSTs /api/mailboxes/gmail/auth
    │
    ▼
Backend stores OAuth state nonce (lib/oauthState)
    │  returns Google OAuth URL with state=<nonce>
    ▼
Browser redirects to accounts.google.com → user consents
    │
    ▼
Google redirects to GET /api/mailboxes/gmail/callback?code=…&state=…
    │
    ▼
app.ts handler validates state → handleCallback(code, state)
    │     ├─ exchanges code for refresh + access tokens
    │     ├─ encrypts and stores in Mailbox.credentials
    │     └─ resolves Gmail display name and emailAddress
    │
    ▼
watchMailbox(mailbox.id)              # gmail.users.watch → Pub/Sub topic
    │
    ▼
syncMessages(mailbox.id)              # initial backfill: pulls recent threads,
                                      # creates Candidate/Thread/Message rows,
                                      # runs classifyAndDraft per inbound reply
    │
    ▼
Redirect user back to /mailboxes with success flag
```

### 2. Inbound email

```
Candidate replies to a recruiter
    │
    ▼
Gmail emits a history event → Pub/Sub topic → push to /api/webhooks/gmail
    │
    ▼
webhooks.ts ACKs 200 immediately, kicks off processWebhook async
    │
    ▼
processWebhook decodes the base64 Pub/Sub message:
    {emailAddress, historyId}
    │
    ▼
syncMessages(mailboxId):
    ├─ pulls history since lastHistoryId via gmail.users.history.list
    ├─ for each new message:
    │   ├─ fetchAndStoreMessage → EmailMessage row (idempotent by externalMessageId)
    │   └─ if inbound + candidate-originated:
    │        └─ classifyAndDraft → Claude call → EmailDraft (status=PENDING)
    └─ updates Mailbox.lastHistoryId
    │
    ▼
Draft visible in the dashboard for the recruiter to review.
```

If the webhook is missed (cold start failure, network hiccup, etc.), the hourly
`reconcile` cron walks `lastHistoryId` for every mailbox and replays the same
`syncMessages` pipeline. The pipeline is idempotent because every write keys on
`externalMessageId` (unique) or `(mailboxId, externalThreadId)` (unique).

### 3. Draft approval

```
Recruiter clicks "Approve & Send" in the dashboard
    │
    ▼
Frontend POSTs /api/drafts/:id/approve
    │
    ▼
drafts.ts:
    ├─ loads EmailDraft + EmailThread + Mailbox
    ├─ createDraft(mailbox, thread, draft.bodyText/Html):
    │     ├─ assembles RFC 2822 message with proper
    │     │   In-Reply-To + References headers for threading
    │     ├─ CCs DRAFT_CC_EMAIL (default sofia@archive.com)
    │     ├─ ghostwrites: From = mailbox owner's display name
    │     └─ POSTs to gmail.users.drafts.create → returns Gmail draft id
    └─ stores externalDraftId on the EmailDraft, status → APPROVED

(separate call) POST /api/drafts/:id/send
    │
    ▼
sendDraft(mailbox, externalDraftId):  # gmail.users.drafts.send
    │
    ▼
On success:
    ├─ EmailDraft.status = SENT, sentAt = now
    └─ Candidate.repliedAt = now, status = REPLIED (if currently PENDING/NEUTRAL)
```

## Decision log

These were not obvious from the code and are worth recording so the next person
doesn't re-litigate them.

- **Prisma over raw SQL.** The schema is small and relational, and we wanted the
  generated client + migration ergonomics. We pay for the ORM with a slightly
  heavier cold start on Vercel; this is fine for a 1–10 RPS workload.
- **Vercel over a stateful host.** The app's only persistent state lives in
  Postgres + Gmail itself; there are no in-process queues, websockets, or
  schedulers that need a long-lived process. Serverless gives us
  zero-ops + auto-scale + free TLS. The cost is cold-start latency on the
  webhook path, which is why we have a reconciliation safety net.
- **Per-user OAuth over Workspace domain-wide delegation.** Initial design used
  a service account with DWD. We switched to per-user OAuth because (a) it works
  for any Gmail account, not just `@archive.com` Workspace accounts, (b) it
  surfaces consent explicitly to each recruiter, and (c) we don't need an admin
  to pre-authorize scopes in the Workspace admin console. The service-account
  code path is still present in `gmail.service.ts` for the case where we want to
  bulk-onboard a Workspace org later.
- **Supavisor session pooler for `POSTGRES_PRISMA_URL`.** Vercel functions are
  ephemeral, and Prisma's default connection pool assumes a long-lived process.
  Hitting Supabase directly would exhaust the database's connection limit under
  any real traffic. Supavisor in session-pooling mode terminates client
  connections at the pooler and multiplexes the actual Postgres backends, which
  is what makes the serverless model viable. `prisma migrate` still uses the
  direct URL (`POSTGRES_URL_NON_POOLING`) because migrations need a real
  Postgres session.
- **CC instead of BCC for oversight.** `DRAFT_CC_EMAIL` is CC'd, not BCC'd, on
  approved drafts. This is deliberate — the recipient sees Sofia is on the
  thread, which is the desired Archive norm. If we wanted silent oversight
  instead, we'd change one line in `createDraft`.
