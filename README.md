# Recruitment Email Automation

A Gmail-monitoring recruiting platform that uses Anthropic's Claude to draft
replies on behalf of recruiters. The app watches connected recruiter mailboxes
via Gmail Pub/Sub push, classifies inbound candidate replies, and produces a
human-reviewable draft in the dashboard. Once a recruiter approves a draft, it
is sent through the recruiter's own Gmail account with `sofia@archive.com`
silently CC'd for oversight.

**Production URL:** https://recruiting-email-automation-api.vercel.app

## Tech stack

- **Backend:** Node.js + Express + Prisma ORM
- **Database:** Postgres (Supabase, via Supavisor session pooler)
- **AI:** Anthropic Claude (`@anthropic-ai/sdk`) — classification + draft generation
- **Frontend:** React + Vite + Tailwind CSS
- **Hosting:** Vercel (single project — frontend at `/`, API at `/api/*`)
- **Auth:** JWT for app users (Google Sign-In, `@archive.com` only) + per-mailbox Gmail OAuth

## Architecture (high-level)

```
Recruiter's Gmail
        │
        ▼
Google Cloud Pub/Sub push
        │
        ▼
POST /api/webhooks/gmail
        │
        ▼
fetchAndStoreMessage      ─► EmailMessage row
        │
        ▼
classifyAndDraft (Claude) ─► EmailDraft (status=PENDING)
        │
        ▼
Recruiter reviews + approves in the dashboard
        │
        ▼
Gmail draft created in recruiter's account + sofia@archive.com CC'd
        │
        ▼
Draft sent  ─► EmailDraft.status = SENT, candidate.repliedAt set
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the per-module breakdown
and data-flow diagrams.

## Getting started (local dev)

```bash
git clone https://github.com/sofiadelgado17/recruitment-email-automation.git
cd recruitment-email-automation
npm install                  # installs workspaces; postinstall runs prisma generate

cp .env.example .env         # fill in the values described below

# In one terminal:
npm run dev:backend          # tsx watch on backend/src/index.ts → :3001

# In another:
npm run dev:frontend         # Vite dev server → :5173 (proxies /api to :3001)
```

The first time you point the backend at a fresh database, run:

```bash
cd backend
npx prisma migrate deploy    # apply all migrations
```

## Required environment variables

These come from `.env.example`. Production values live in the Vercel project
settings; local values go in a `.env` file at the repo root.

| Variable | Purpose |
|---|---|
| `POSTGRES_PRISMA_URL` | Pooled Postgres URL used at runtime (Supavisor session pooler in prod). |
| `POSTGRES_URL_NON_POOLING` | Direct Postgres URL used by `prisma migrate`. |
| `ANTHROPIC_API_KEY` | Claude API key for classification and draft generation. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | OAuth client used when a recruiter connects their mailbox. |
| `GMAIL_REDIRECT_URI` | Must match a redirect URI registered in Google Cloud Console. Local: `http://localhost:3001/api/mailboxes/gmail/callback`. Production: `https://<your-vercel-domain>/api/mailboxes/gmail/callback`. |
| `GMAIL_PUBSUB_TOPIC` | Fully-qualified Pub/Sub topic (e.g. `projects/foo/topics/gmail-watch`) that each mailbox watch publishes to. |
| `JWT_SECRET` | HMAC secret for app-user JWTs (Google Sign-In). |
| `ENCRYPTION_KEY` | 32 random bytes, base64. Encrypts `Mailbox.credentials` (OAuth refresh tokens) at rest with AES-256-GCM. Generate with `openssl rand -base64 32`. |
| `CRON_SECRET` | Shared secret. Vercel Cron must send `Authorization: Bearer <CRON_SECRET>` when hitting `/api/internal/cron/*`. |
| `DRAFT_CC_EMAIL` | Address CC'd on every approved/sent draft. Defaults to `sofia@archive.com`. |
| `PORT` | Local dev only; Vercel ignores this. |
| `FRONTEND_URL` | Local CORS origin (`http://localhost:5173`). Unused in production since frontend and API share an origin. |
| `GOOGLE_SERVICE_ACCOUNT_KEY_JSON` | Optional — Workspace service-account JSON, single line. Currently unused in the live system; safe to leave blank. |
| `AZURE_CLIENT_ID` / `_SECRET` / `_TENANT_ID` | Optional Outlook OAuth — provider stub exists in `email.service.ts` but is not wired up. |
| `VITE_API_URL` | Optional override for the frontend API base. Leave unset in production. |

## Deploying

Single Vercel project. The GitHub App auto-deploys on push to
`claude/email-automation-system-OEgcU` (the production branch on
`sofiadelgado17/recruitment-email-automation`).

- `npm run vercel-build --workspace=backend` runs `prisma generate && prisma migrate deploy` — pending migrations are applied automatically as part of every deploy.
- `npm run build --workspace=frontend` builds the React app into `frontend/dist`, which Vercel serves as static assets.
- The API entrypoint is `api/index.ts`, which re-exports the Express app from `backend/src/app.ts`. Vercel wraps it as a serverless function via the `functions` block in `vercel.json`.
- `vercel.json` also registers the cron jobs and SPA rewrites — see [docs/OPERATIONS.md](docs/OPERATIONS.md#vercel-config).

## Database migrations

Migrations live in `backend/prisma/migrations/`. Locally:

```bash
cd backend
npx prisma migrate dev       # generates a new migration when schema.prisma changes
```

In production, the `vercel-build` script runs `prisma migrate deploy` on every
deploy — there is no separate migration step. If a migration is malformed, the
Vercel build fails and the previous deploy stays live.

## Reliability

Inbound ingestion has two paths so a single failure can't lose messages:

| Path | Cadence | Endpoint | Purpose |
|---|---|---|---|
| Pub/Sub push (primary) | Real-time, ~5–30s latency | `POST /api/webhooks/gmail` | Each connected mailbox publishes to a Pub/Sub topic; Google pushes to our webhook on every change. |
| Watch renewal cron | Every 6 hours | `POST /api/internal/cron/renew-watches` | Gmail watches expire after 7 days. The cron re-issues `users.watch` before they lapse. |
| Reconciliation cron | Every hour | `POST /api/internal/cron/reconcile` | Walks each mailbox's recent `historyId` and ingests any messages the webhook missed (e.g. during a Vercel cold start, a 5xx, or a dropped Pub/Sub delivery). |

The current sync state of every mailbox is exposed at
`GET /api/internal/sync-health` (JWT-protected). See
[docs/OPERATIONS.md#runbook](docs/OPERATIONS.md#runbook).

## Security model

- **App users** (recruiters logging into the dashboard) sign in with Google. The backend (`backend/src/routes/auth.ts`) verifies the Google ID token and rejects anything that isn't `@archive.com`. On success it issues a 7-day JWT signed with `JWT_SECRET`.
- **Mailbox access** is per-recruiter Gmail OAuth, not domain-wide delegation. Each connected mailbox stores its own OAuth refresh token. (A Workspace service-account path exists in `gmail.service.ts` but is unused in production — see [docs/ARCHITECTURE.md#decision-log](docs/ARCHITECTURE.md#decision-log).)
- **Refresh tokens** are encrypted at rest with **AES-256-GCM** keyed by `ENCRYPTION_KEY` (`backend/src/lib/crypto.ts`). The `Mailbox.credentials` column never stores plaintext OAuth material.
- **Cron endpoints** (`/api/internal/cron/*`) are authenticated via the `CRON_SECRET` bearer header, not JWT. The webhook (`/api/webhooks/gmail`) is intentionally public so Pub/Sub can reach it; it validates the Pub/Sub payload shape before doing work.

## Useful commands

```bash
# Run backend tests (Vitest)
cd backend && npm test

# Interactive DB browser
cd backend && npx prisma studio

# Apply a new schema change locally
cd backend && npx prisma migrate dev

# Run the seed script (creates a sample mailbox + candidate)
cd backend && npm run seed

# Build everything the way Vercel does
npm run build
```

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — per-module narrative, data-flow diagrams, decision log.
- [docs/OPERATIONS.md](docs/OPERATIONS.md) — runbook, incident remediation, deploy/rollback, env-var checklist.
- [docs/TESTING.md](docs/TESTING.md) — how to run and write tests, CI setup, coverage targets.
- [backend/SETUP.md](backend/SETUP.md) — original Google Cloud / service-account setup notes.
