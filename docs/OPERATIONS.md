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
| `authStatus` / `lastAuthError` / `lastAuthErrorAt` | `NEEDS_REAUTH` means Google rejected the mailbox's OAuth grant (`invalid_grant` / 401). **Nothing is being ingested** for that mailbox until its owner reconnects — see [Mailbox needs reconnect](#mailbox-needs-reconnect-needs_reauth--invalid_grant). |
| `watchExpiry` / `watchExpiresInHours` | When the Gmail watch lapses. The renewal cron should keep this >24h. If it's <0, push delivery has stopped for that mailbox. |
| `lastSyncedMessageAt` | Timestamp of the most recent ingested message. If this is hours stale on an active mailbox, something is wrong. |
| `lastReconciliationAt` / `lastReconciliationFoundMissing` | Last successful hourly reconcile for this mailbox and how many messages it had to backfill. Older than 3h = the mailbox is not syncing. |
| `consecutiveReconcileFailures` / `lastReconcileError` | `RECONCILIATION_FAILED` rows since the last success (48h window) and the newest error. 3+ = not syncing. |
| `messagesLast24h` | Sanity-check volume per mailbox. Zeroes on a known-active inbox = problem. |
| `pendingDrafts`, `candidatesNeedsReview` | Operational backlog. Helps spot whether the issue is ingestion or recruiters not clearing their queue. |
| `isActive` | `false` only after a manual disconnect (`DELETE /api/mailboxes/:id`). A revoked token does **not** flip this — check `authStatus`. Inactive mailboxes are omitted from sync-health. |
| `error` | `true` when the backend could not compute part of the row (count fields are then `null`, not `0`). Retry; persistent `true` = DB pool exhaustion. |

The dashboard's health pill ranks states worst-first: rose **"N mailboxes:
reconnect required"** (NEEDS_REAUTH or expired watch) → rose **"N mailboxes
not syncing"** (3+ reconcile failures or no reconcile in 3h) → amber (incomplete
data, ≥10 webhook errors/24h, drift ≥10, watch expiring <24h) → green. Any rose
state auto-expands the Mailbox health accordion.

### Logs

Two surfaces:

- **`SystemLog` rows** (the source of truth). Query in Prisma Studio or via SQL:
  ```sql
  SELECT "createdAt", level, event, details FROM "SystemLog"
  WHERE level IN ('WARN', 'ERROR')
  ORDER BY "createdAt" DESC LIMIT 50;
  ```
- **Vercel runtime logs.** Vercel dashboard → Project → Logs. Filter on the
  function path (`/api/webhooks/gmail`, `/api/internal/cron/reconcile`, etc.).
  Useful for stack traces that didn't make it to `SystemLog`. **Retained for
  under 24h** — anything you need later must be in `SystemLog` (or a log drain).
  Errors are logged through `lib/safeError` (name/message/code/status only);
  never `console.error(err)` a googleapis error — it carries OAuth tokens.

## Alerting

There is one alert path: the **watchdog cron** (`GET
/api/internal/cron/watchdog`, every 15 min) posts to Slack via
`SLACK_ALERT_WEBHOOK_URL`. It alerts **on state change only** — one message
when issues appear, one "resolved" message when they clear — never every run.

| Issue key | Severity | Fires when |
|---|---|---|
| `needs_reauth:<mailboxId>` | critical | Mailbox `authStatus = NEEDS_REAUTH`. |
| `watch_expired:<mailboxId>` | critical | Active, auth-OK mailbox whose Gmail watch is missing or past `watchExpiry`. |
| `reconcile_stale:<mailboxId>` | warning | No per-mailbox `RECONCILIATION_RUN` in 3h (mailbox older than 3h; suppressed while `reconcile_dead` fires). |
| `reconcile_dead` | critical | Dead-man's switch: no `RECONCILIATION_RUN` at all in 2h (cron not running / function crashing). |
| `reconcile_deadline` | warning | Last 3 reconcile summaries all hit the 45s start budget (mailboxes being skipped). |
| `webhook_errors` | warning | ≥20 `WEBHOOK_HANDLER_ERROR` rows in the last hour. |

State is the latest `WATCHDOG_STATE` row in `SystemLog` (`details.active` =
issues already announced). An issue is only recorded as announced if the Slack
post succeeded, so a Slack outage retries every 15 min.

**If `SLACK_ALERT_WEBHOOK_URL` is unset**, alerting is a no-op (one
`[Alert] … alerts are disabled` warning per function instance) and the
watchdog response says `"alerting": "disabled"`. Nothing is recorded, so the
moment the variable is set, every currently-open issue is announced once.

To run it by hand (returns the current issue list):

```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
  https://recruiting-email-automation-api.vercel.app/api/internal/cron/watchdog
```

Thresholds live in `WATCHDOG_THRESHOLDS` (`backend/src/services/monitoring.service.ts`).
Other services can send ad-hoc alerts with `sendAlert({ severity, title, text })`
from `services/alert.service.ts` (never throws; no dedupe — callers on a
schedule must dedupe themselves).

### External uptime monitor

`GET /api/health/deep` (public, no auth) evaluates the same issues and returns
**503** with `status: "degraded"` (or `"unhealthy"` if the DB is down) and only
counts by type, e.g. `{"issues":{"needs_reauth":1}}` — no addresses. Point an
external uptime monitor (Better Stack, UptimeRobot, …) at it so you still get
paged if Vercel cron or Slack itself is broken. Cached 60s per instance.
`GET /api/health` remains the cheap liveness probe (DB + Claude key shape only).

## Sender coverage

Gem sequences are often sent from executive send-aliases (e.g. `ethan@`, `p.benigeri@`). If no connected mailbox receives replies to an alias, those replies never reach the app. `services/coverage.service.ts` diffs the **expected senders** against what is monitored (every active `Mailbox.emailAddress` plus its stored Gmail `sendAsAddresses`).

- **Expected senders** are an admin-maintained list (`ExpectedSender` table). Manage it in Dashboard → Sender coverage (expand) or `GET/POST/PATCH/DELETE /api/coverage/expected-senders` (admin). There is no Gem API credential on the server yet; the `ExpectedSenderSource` interface in `coverage.service.ts` is the seam for a future Gem sync.
- **Report**: `GET /api/coverage` (any signed-in user) returns `unmonitored` senders and `quietMailboxes` (connected, 0 outbound in 30 days while sends are expected; an explicit `expectedSends30d = 0` suppresses it).
- **sendAs aliases** are refreshed whenever a signature is fetched and by the weekly cron. Messages from an alias count as outbound; senders on `INTERNAL_DOMAINS` (default `archive.com`) are never classified or turned into Candidates.
- **Weekly Slack summary**: `GET /api/internal/cron/coverage-summary` (Mondays 14:00 UTC) refreshes sendAs for healthy mailboxes, then posts via `alert.service` (no-op without `SLACK_ALERT_WEBHOOK_URL`) and logs `SENDER_COVERAGE_SUMMARY` (counts only).
- **Fixing a gap**: connect the mailbox, add the alias as a Gmail send-as on a connected mailbox (it is picked up on the next refresh), or route replies to a connected mailbox. Then remove or deactivate the entry if it should no longer be expected.

## Common incidents

### Mailbox needs reconnect (`NEEDS_REAUTH` / `invalid_grant`)

**This is how sofia@ was lost for 5 months (2026-05-25 → 2026-10) and how
aaronrampersad@ started failing on 2026-10-21.** Google stops honouring a
mailbox's refresh token when the user revokes access, changes their password,
an admin resets the account, or the grant expires. Every Gmail call then
fails with `invalid_grant` (token endpoint) or 401.

What the app does automatically:

1. The first call that hits it (webhook, hourly reconcile, 6-hourly renew,
   resync, draft send) sets `Mailbox.authStatus = 'NEEDS_REAUTH'`,
   `lastAuthError`, `lastAuthErrorAt`, and writes **one**
   `MAILBOX_AUTH_REVOKED` ERROR row (one per incident, not per run).
2. Reconcile and renew-watches skip the mailbox from then on; API routes that
   need it (resync, approve/send draft) return **409 "needs to be
   reconnected"**.
3. The watchdog posts a critical Slack alert within 15 min; the dashboard pill
   turns rose ("reconnect required") and the account row shows **Reconnect**.

What a human must do:

1. The **mailbox owner** (signed in to Google as that address) clicks
   **Reconnect** on the dashboard row, or Mailboxes → Connect Gmail. The
   OAuth callback upserts by address, resets `authStatus` to `OK` (logs
   `MAILBOX_AUTH_RESTORED`), re-creates the Gmail watch, and syncs the last
   7 days.
2. Click **Resync** on the mailbox (30-day backfill,
   `POST /api/mailboxes/:id/resync`).
3. **Gap check.** The hourly reconcile only looks back 24–48h and resync 30
   days / 250 messages. If the mailbox was broken longer than that, the gap
   needs a one-off wider backfill — do not assume it self-heals.
4. The watchdog posts "Resolved" on its next run.

Check state:

```sql
SELECT "emailAddress", "authStatus", "lastAuthError", "lastAuthErrorAt", "watchExpiry"
FROM "Mailbox" WHERE "isActive" = true ORDER BY "authStatus" DESC, "emailAddress";

SELECT "createdAt", details FROM "SystemLog"
WHERE event IN ('MAILBOX_AUTH_REVOKED', 'MAILBOX_AUTH_RESTORED')
ORDER BY "createdAt" DESC LIMIT 20;
```

Don't set `authStatus` back to `OK` by hand to "retry" — if the grant is still
revoked, the next cron flips it straight back (and alerts again).

### Watch expired (`watchExpiresInHours` is negative)

Symptom: no new inbound messages for a specific mailbox; `lastSyncedMessageAt`
is stale but `reconcileMailbox` is still catching things up hourly.

First check `authStatus` — if it is `NEEDS_REAUTH`, follow the section above;
renewing cannot work without a valid grant.

The 6-hourly renewal cron should prevent this. Each failed renewal writes a
`GMAIL_WATCH_RENEW_FAILED` ERROR row with the sanitized error; check those
first. Then trigger renewal manually (crons are **GET**):

```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
  https://recruiting-email-automation-api.vercel.app/api/internal/cron/renew-watches
```

Verify by re-fetching `/api/internal/sync-health` and confirming
`watchExpiresInHours` is positive (~167) again.

### Drift detected (`lastReconciliationFoundMissing` > 0)

By design — this is the reconciliation cron doing its job; the hourly run
healed the gap automatically. As of the 2026-10 audit most mail arrives via
reconcile rather than the webhook (see audit H4), so small non-zero drift on
every run is currently **normal**. Investigate when drift is large (≥10 per
run, amber on the dashboard) or the watchdog fires `reconcile_stale` /
`reconcile_deadline`. Check Vercel logs for `/api/webhooks/gmail` 5xx or
timeouts.

To force an immediate reconciliation (crons are **GET**):

```bash
curl -H "Authorization: Bearer ${CRON_SECRET}" \
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

`Mailbox.isActive = false` means someone **manually disconnected** it
(`DELETE /api/mailboxes/:id`); it disappears from sync-health and the crons.
It is *not* set by token revocation — that is `authStatus = NEEDS_REAUTH`
(see [Mailbox needs reconnect](#mailbox-needs-reconnect-needs_reauth--invalid_grant)).
To bring it back, the owner connects it again via Mailboxes → Connect Gmail.

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
| `crons` | `0 */6 * * *` → `/api/internal/cron/renew-watches`; `0 * * * *` → `/api/internal/cron/reconcile`; `*/15 * * * *` → `/api/internal/cron/watchdog`. All are **GET**. Vercel sends `Authorization: Bearer <CRON_SECRET>` on each call (requires the `CRON_SECRET` env var); the handler accepts only that header and compares it in constant time. |

## Required Vercel env vars

- `INTERNAL_DOMAINS` (optional, comma-separated, default `archive.com`): senders on these domains are colleagues and never become candidates.

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
| `ENCRYPTION_KEY` | Exactly 32 random bytes, base64. Used by `lib/crypto`; new ciphertext is tagged `v<ENCRYPTION_KEY_VERSION>:`. To rotate: move the old key to `ENCRYPTION_KEY_PREVIOUS`, set the new `ENCRYPTION_KEY`, bump `ENCRYPTION_KEY_VERSION` (default `1`). Old rows keep decrypting and are re-encrypted on next write. |
| `ALLOWED_USERS` | Optional sign-in allowlist (comma-separated). Unset = any `@archive.com` Workspace account (`hd` claim checked). |
| `ADMIN_EMAILS` | Comma-separated; promoted to `admin` on sign-in, never demoted, always allowed to sign in. No default. |
| `PUBSUB_SERVICE_ACCOUNT_EMAIL` | Push subscription's service account; required `email` claim on webhook JWTs when `PUBSUB_AUDIENCE` is set. |
| `ORPHAN_BODY_RETENTION_DAYS` | Optional, destructive. Enables the daily orphan-body purge (integer ≥ 7). Unset = no-op. |
| `CRON_SECRET` | Bearer secret for `/api/internal/cron/*`. |
| `SLACK_ALERT_WEBHOOK_URL` | Slack incoming-webhook URL for watchdog alerts. Optional — unset = alerting disabled (no-op, warned once). See [Alerting](#alerting). |
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

## Security model

### Single-tenant by design

This is a **single-tenant** app: every authenticated `@archive.com` user sees
and can act on every candidate, draft, and mailbox. There is no per-user
filtering on list/read/write endpoints and the data model has no `ownerUserId`
or org column. The current `requireAuth` middleware confirms the caller is a
real Archive employee; **it intentionally does not gate access to data that
belongs to other recruiters at Archive.**

If you ever fork this for a multi-tenant deployment (multiple companies, or
even isolating per-recruiter visibility inside Archive), you must:

1. Add an `orgId` / `ownerUserId` column to `Mailbox` (and through to
   `Candidate`, `EmailThread`, `EmailMessage`, `EmailDraft`).
2. Backfill ownership for existing rows.
3. Add `where: { ownerUserId: req.userId }` (or org-scoped equivalent) to
   every list/get/update/delete query.
4. Add tests that prove cross-tenant reads return 404 — the easiest mistake
   here is omitting the filter on a new route.

Until that work happens, treat the app as a shared inbox.

### RBAC: recruiter vs admin

Two roles live on `User.role`:

- **`recruiter`** (default for new sign-ins): can list/get candidates, drafts,
  threads, and mailboxes; can approve/discard individual drafts; can ignore
  candidates. Sees everything in the shared tenant.
- **`admin`**: everything `recruiter` can do, plus the bulk / destructive
  endpoints guarded by `requireAdmin`:
  - `POST /api/mailboxes/:id/resync`
  - `POST /api/mailboxes/:id/refresh-profile`
  - `POST /api/mailboxes/refresh-all-profiles`
  - `DELETE /api/mailboxes/:id`
  - `POST /api/drafts/regenerate-pending`
  - `POST /api/candidates/backfill-roles`

Migration `6_user_role` adds the column and promotes `andriy@archive.com` to
admin via a one-time data migration. The Google sign-in path also re-asserts
that promotion as a belt-and-braces (in case the row didn't exist when the
migration ran). To promote another user, update the row directly:

```sql
UPDATE "User" SET role = 'admin' WHERE email = 'someone@archive.com';
```

There is no UI for managing roles — this is intentional. The set of admins
should be small and rotate through SQL when needed.

### JWT expiry

App-user JWTs are signed with `JWT_SECRET` and expire **7 days** after issue
(`TOKEN_EXPIRES_IN` in `backend/src/services/auth.service.ts`). There is no
refresh-token rotation: when the token expires, the dashboard's API calls
return 401, the frontend clears local state, and the user re-authenticates
via Google Sign-In. If longer sessions are needed (e.g. for a kiosk-style
deployment), implement a refresh-token endpoint that re-issues a JWT when
the user presents a still-valid refresh token. Don't lengthen the JWT TTL
itself — short-lived bearer tokens are the entire reason we don't store a
revocation list.

### OAuth state storage (known limitation)

`backend/src/lib/oauthState.ts` keeps OAuth state tokens in a process-local
`Map` with a 10-minute TTL. On Vercel's serverless runtime, each invocation
can land on a different cold-start instance, so the state issued at
`/api/mailboxes/gmail/auth` may not be present when Google redirects back to
`/api/mailboxes/gmail/callback` seconds later. In practice warm-start reuse
keeps this working ~95% of the time; cold-start mismatches surface as
"Invalid or expired OAuth state" and the user retries.

The production-grade fix is to move state into Redis / Upstash KV so all
invocations share the same store. That migration was deliberately left out
of the Phase AO security batch because it's a non-trivial integration
(new dependency, new env vars, new failure mode). Track it as a follow-up;
do **not** add Redis until the failure mode actually hurts users at scale.

### Content-Security-Policy (CSP)

Helmet emits a tuned CSP on every `/api/*` response (`backend/src/app.ts`):
self-origin defaults, plus `https://accounts.google.com`,
`https://apis.google.com`, and `https://www.googleapis.com` for Google Sign-In.
`styleSrc` keeps `'unsafe-inline'` because both Vite and Radix emit inline
styles.

**Static assets are not covered.** The dashboard HTML + JS bundles ship from
Vercel's static layer (see `vercel.json` `outputDirectory`), which does not
inherit Express headers. Extending CSP to those responses is a known follow-up;
the blocker is the inline `<script>` in `frontend/index.html` that pre-applies
the dark/light theme before first paint. To do it safely:

1. Compute the SHA-256 of the inline script body and add
   `'sha256-…'` to `scriptSrc` in a `vercel.json` `headers` block.
2. Re-compute the hash whenever the bootstrap script changes (consider moving
   it to an external file to skip this step entirely).

Adding `'unsafe-inline'` to `scriptSrc` would technically work but defeats the
point of CSP for XSS protection — don't take that shortcut without an
explicit decision in the PR description.

### Pub/Sub webhook authentication

`POST /api/webhooks/gmail` is publicly reachable (Google needs to POST to it).
When `PUBSUB_AUDIENCE` is set, the handler verifies the OIDC token in the
`Authorization: Bearer …` header against that audience and rejects anything
unsigned. When `PUBSUB_SERVICE_ACCOUNT_EMAIL` is also set, the token's
verified `email` claim must equal it — set both, since any GCP principal can
mint a Google-signed token for an arbitrary audience. With `PUBSUB_AUDIENCE`
unset the handler stays fail-open and logs a sampled console warning (so a
deploy can never drop pushes before GCP is configured). Rejections write at
most one `WEBHOOK_AUTH_REJECTED` row per minute per instance.

To configure: in GCP, set the push subscription's authentication service
account and OIDC token audience to the URL of the webhook (e.g.
`https://recruiting-email-automation-api.vercel.app/api/webhooks/gmail`),
then set `PUBSUB_AUDIENCE` to that same URL and `PUBSUB_SERVICE_ACCOUNT_EMAIL`
to the subscription's service account in Vercel. Confirm pushes still land
(sync-health, no `WEBHOOK_AUTH_REJECTED` rows) before relying on it.

