# Operations

Operator handbook for the production system at
https://recruiting-email-automation-api.vercel.app. Read
[ARCHITECTURE.md](ARCHITECTURE.md) first if you haven't.

## Runbook

### First place to look: sync-health

```bash
curl -H "Authorization: Bearer <your-jwt>" \
  https://recruiting-email-automation-api.vercel.app/api/internal/sync-health
```

`GET /api/internal/sync-health` returns one entry per mailbox with the fields
that matter for diagnosing ingestion problems:

| Field | What it tells you |
|---|---|
| `watchExpiry` / `watchExpiresInHours` | When the Gmail watch lapses. The renewal cron should keep this >24h. If it's <0, push delivery has stopped for that mailbox. |
| `lastSyncedMessageAt` | Timestamp of the most recent ingested message. If this is hours stale on an active mailbox, something is wrong. |
| `lastReconciliationAt` / `lastReconciliationFoundMissing` | Did the hourly cron find messages the push had missed? Persistent non-zero `foundMissing` means the webhook path is unhealthy. |
| `messagesLast24h` | Sanity-check volume per mailbox. Zeroes on a known-active inbox = problem. |
| `pendingDrafts`, `candidatesNeedsReview` | Operational backlog. Helps spot whether the issue is ingestion or recruiters not clearing their queue. |
| `isActive` | If `false`, the mailbox was disconnected (refresh-token revoked or hit a permanent auth error). User must re-OAuth. |

### Logs

Two surfaces:

- **`SystemLog` rows** (the source of truth). Query in Prisma Studio or via SQL:
  ```sql
  SELECT created_at, level, event, details FROM "SystemLog"
  WHERE level IN ('WARN', 'ERROR')
  ORDER BY created_at DESC LIMIT 50;
  ```
- **Vercel runtime logs.** Vercel dashboard → Project → Logs. Filter on the
  function path (`/api/webhooks/gmail`, `/api/internal/cron/reconcile`, etc.).
  Useful for stack traces that didn't make it to `SystemLog`.

## Common incidents

### Watch expired (`watchExpiresInHours` is negative)

Symptom: no new inbound messages for a specific mailbox; `lastSyncedMessageAt`
is stale but `reconcileMailbox` is still catching things up hourly.

The 6-hourly renewal cron should prevent this, but if it failed (e.g. a deploy
broke it), trigger it manually:

```bash
curl -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://recruiting-email-automation-api.vercel.app/api/internal/cron/renew-watches
```

Verify by re-fetching `/api/internal/sync-health` and confirming
`watchExpiresInHours` is positive (~167) again.

### Drift detected (`lastReconciliationFoundMissing` > 0)

By design — this is the reconciliation cron doing its job; the hourly run
healed the gap automatically. Investigate only if `foundMissing` is **non-zero
on multiple consecutive runs**, which means the primary push path is failing
and the recon is masking it. Check Vercel logs for `/api/webhooks/gmail` 5xx or
timeouts.

To force an immediate reconciliation:

```bash
curl -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://recruiting-email-automation-api.vercel.app/api/internal/cron/reconcile
```

### Single message appears dropped

1. Confirm the Gmail message ID — ask the recruiter to forward the message.
2. In Vercel logs, search the request log around the receive time for the
   webhook call. If you find a 5xx, you have the culprit.
3. Don't panic about a one-off — the hourly reconciliation cron will pick it
   up within the next 60 minutes. If a recruiter is on a call and needs it
   immediately, fire the `reconcile` endpoint manually (above).

### Wrong persona / tone in drafts

A draft was generated using a stale or wrong prompt context (e.g. the wrong
mailbox owner display name was on the row when classification ran — fixed in
Phase L, but old drafts may persist).

Options:

- **One draft:** the recruiter can click **Regenerate** in the dashboard —
  triggers `POST /api/drafts/:id/regenerate`.
- **All currently-pending drafts:** an admin can call:
  ```bash
  curl -X POST \
    -H "Authorization: Bearer <admin-jwt>" \
    https://recruiting-email-automation-api.vercel.app/api/drafts/regenerate-pending
  ```
  This re-runs `classifyAndDraft` against the latest source message for every
  draft whose status is still `PENDING`. APPROVED/SENT drafts are not touched.

### Mailbox disconnected

`Mailbox.isActive = false` and `/api/internal/sync-health` shows the entry as
inactive. Almost always means the refresh token was revoked from Google's side
(user removed the consent, password change, etc.). There is no server-side
recovery — the recruiter must:

1. Open the dashboard.
2. Go to **Mailboxes**.
3. Click **Reconnect** on the affected row (kicks off the OAuth flow again,
   re-issues a refresh token, re-encrypts to `Mailbox.credentials`, re-runs
   `watchMailbox`).

## Deploys

### How a deploy happens

Push to `claude/email-automation-system-OEgcU` on
`sofiadelgado17/recruitment-email-automation`. The Vercel GitHub App picks it
up automatically and runs:

```
npm install
npm run vercel-build --workspace=backend   # prisma generate && prisma migrate deploy
npm run build --workspace=frontend         # vite build → frontend/dist
```

If both succeed, Vercel promotes the deploy. If either fails, the previous
deploy stays live.

### Vercel deployment failures

Check Vercel → Deployments → the failed run → **Build Logs**.

Common failure modes:

- **`prisma migrate deploy` errors.** A migration is malformed or conflicts
  with the current DB state. The deploy fails fast — the live site is unaffected.
  Fix the migration locally (`prisma migrate dev` in a fresh DB to validate)
  and re-push.
- **`tsc` errors in `backend/build`.** Type error landed on the branch. Same
  pattern — fix and re-push.
- **`vite build` errors in frontend.** Usually a missing env var (the build is
  strict in production mode). Cross-check the Vercel env-var set.

### Rolling back

Use a GitHub revert PR. Click **Revert** on the offending merge commit in the
GitHub UI, merge the revert PR — Vercel deploys it automatically. There is no
"redeploy previous" button worth using because the schema may have advanced;
the revert PR forces you to think about whether a down-migration is needed.
Migrations have so far been additive (new columns/tables), so reverts are
generally safe.

## Vercel config

`vercel.json` controls four things in production:

| Block | Purpose |
|---|---|
| `buildCommand` | Runs `prisma generate && prisma migrate deploy` on the backend, then `vite build` on the frontend. |
| `outputDirectory: "frontend/dist"` | What Vercel serves as static. |
| `functions["api/index.ts"].includeFiles` | Bundles `backend/**` into the serverless function so the Express app can import its own modules at runtime. |
| `rewrites` | `/api/:path*` → `/api/index` (the Express app); everything else → `/index.html` (SPA fallback), except the literal `/assets/` prefix used by Vite-built bundles. |
| `crons` | `0 */6 * * *` → `/api/internal/cron/renew-watches`; `0 * * * *` → `/api/internal/cron/reconcile`. Vercel signs each call with `x-vercel-cron-signature`; our handler accepts that or a `Bearer <CRON_SECRET>` header. |

## Required Vercel env vars

Set under **Project Settings → Environment Variables** (Production scope).

| Variable | Notes |
|---|---|
| `POSTGRES_PRISMA_URL` | Supavisor session-pooled URL. |
| `POSTGRES_URL_NON_POOLING` | Direct Postgres URL (for `prisma migrate deploy` at build time). |
| `ANTHROPIC_API_KEY` | Claude API key. |
| `GMAIL_CLIENT_ID` | Google Cloud OAuth client ID. |
| `GMAIL_CLIENT_SECRET` | Matching client secret. |
| `GMAIL_REDIRECT_URI` | Must be `https://<prod-domain>/api/mailboxes/gmail/callback` and must be registered in Google Cloud Console under the OAuth client. |
| `GMAIL_PUBSUB_TOPIC` | Fully-qualified Pub/Sub topic name. |
| `JWT_SECRET` | 32+ random bytes for JWT signing. |
| `ENCRYPTION_KEY` | 32 random bytes, base64. Used by `lib/crypto`. Rotating this **invalidates every stored mailbox credential** — don't rotate without a re-OAuth plan. |
| `CRON_SECRET` | Bearer secret for `/api/internal/cron/*`. |
| `DRAFT_CC_EMAIL` | Optional — defaults to `sofia@archive.com`. |
| `FRONTEND_URL` | Not used in production (same-origin) but Express CORS config reads it — set to the prod domain to be safe. |

Optional / inactive:

- `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` — Workspace domain-wide delegation path. Not in use.
- `AZURE_*` — Outlook provider stub. Not wired up.
- `VITE_API_URL` — leave unset so the frontend talks same-origin.

## External service config

### Google Cloud

- **OAuth client** (Web application) must have these redirect URIs registered:
  - `http://localhost:3001/api/mailboxes/gmail/callback` (local dev)
  - `https://recruiting-email-automation-api.vercel.app/api/mailboxes/gmail/callback`
- **OAuth consent screen** is in External + Production. Scopes used:
  `gmail.modify`, `gmail.send`, `userinfo.email`, `userinfo.profile`,
  `openid`.
- **Pub/Sub topic** (whose name is `GMAIL_PUBSUB_TOPIC`) must exist and have a
  push subscription pointing at `POST /api/webhooks/gmail`. The Gmail service
  account `gmail-api-push@system.gserviceaccount.com` needs the
  **Pub/Sub Publisher** role on the topic, or `gmail.users.watch` will fail.
- **Service account** (only used if you switch to Workspace DWD) — currently
  has no production impact. Safe to ignore.

### Supabase

- **Connection strings** — copy both from the Supabase dashboard:
  - **Connection pooling → Session pooler** → `POSTGRES_PRISMA_URL`
  - **Connection string → Direct connection** → `POSTGRES_URL_NON_POOLING`
- **Password resets** are done via the Supabase Management API (PAT auth)
  rather than the dashboard so the new password can be templated into the
  connection strings programmatically. The orchestrator's PAT lives at
  `~/.config/claude-code/supabase-access-token`.
- The DB has no row-level security policies — it's accessed exclusively by the
  trusted server. Don't enable RLS without auditing the queries first.

## Cost expectations

Order-of-magnitude estimates at current usage (~8 mailboxes, low single-digit
RPS):

| Service | Driver | Approx. cost |
|---|---|---|
| Anthropic Claude | One classification + one draft per inbound candidate reply | ~$0.01–0.05 per draft, depending on thread length and model tier |
| Supabase | One small Postgres project | $10 / month (Pro) |
| Vercel | Functions + cron + bandwidth | Mostly within the Pro free tier; cron alone is free |
| Google Cloud | Pub/Sub + Gmail API quota | Effectively $0 at this volume |

The dominant variable cost is Claude. If draft volume jumps, the place to
optimize is the prompt size in `claude.service.ts`, not the infra.
