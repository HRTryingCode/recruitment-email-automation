# Backend Setup Guide

## Prerequisites

- Node.js 18+
- A Google Cloud project with the Gmail API enabled
- Either a Google OAuth 2.0 client OR a Google Workspace service account with domain-wide delegation

---

## 1. Google Cloud — Service Account (Recommended for Workspace)

If your company uses Google Workspace (e.g. archive.com), a single service account with
domain-wide delegation can access all 8 recruiter mailboxes without individual OAuth consent.

### Steps

1. In the Google Cloud Console, create a service account under your project.
2. Generate a JSON key for the service account and download it (e.g. `service-account-key.json`).
3. In the Google Workspace Admin Console:
   - Go to **Security → API Controls → Domain-wide Delegation**.
   - Add the service account's Client ID.
   - Grant the scope: `https://www.googleapis.com/auth/gmail.modify`
4. Save the JSON key file somewhere safe (e.g. `backend/secrets/service-account-key.json`).
   Make sure it is listed in `.gitignore` — **never commit credentials**.

---

## 2. Environment Variables

Copy the example env file and fill in your values:

```bash
cp ../.env.example backend/.env
# or copy from the root:
cp .env.example .env
```

Key variables to set in `.env`:

```
# Required for AI draft generation
ANTHROPIC_API_KEY=sk-ant-...

# Option A: Path to the service account JSON key file
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./secrets/service-account-key.json

# Option B: Inline JSON string (useful for CI/secrets managers)
# GOOGLE_SERVICE_ACCOUNT_KEY_JSON={"type":"service_account",...}

# Standard Gmail OAuth (needed only if using individual OAuth per mailbox)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=http://localhost:3000/api/mailboxes/gmail/callback

# Optional — for Gmail push notifications via Pub/Sub
# GMAIL_PUBSUB_TOPIC=projects/your-project/topics/gmail-notifications

FRONTEND_URL=http://localhost:5173
PORT=3000
NODE_ENV=development
```

---

## 3. Install & Migrate

```bash
cd backend

# Install dependencies
npm install

# Generate Prisma client
npm run db:generate

# Run database migrations (creates backend/prisma/dev.db)
npm run db:migrate

# Seed the database with real candidate data
npm run seed
```

---

## 4. Connect Workspace Mailboxes

Once the server is running, call the workspace connect endpoint to register all recruiter
mailboxes at once using the service account:

```bash
curl -X POST http://localhost:3000/api/mailboxes/workspace/connect \
  -H 'Content-Type: application/json' \
  -d '{
    "emailAddresses": [
      "aaronrampersad@archive.com",
      "pbenigeri@archive.com",
      "benigeri.paul@archive.com",
      "emaenza@archive.com"
    ]
  }'
```

This validates each mailbox by listing one message, then stores the service account credential
reference in the database. No per-user OAuth dance needed.

---

## 5. Start the Dev Server

```bash
# Backend (from /backend)
npm run dev

# Frontend (from /frontend, in a separate terminal)
npm run dev
```

The API will be available at `http://localhost:3000/api`.
The frontend will be available at `http://localhost:5173`.

---

## Script Reference

| Script | Description |
|--------|-------------|
| `npm run dev` | Start backend with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Run compiled output |
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate` | Apply migrations (creates/updates dev.db) |
| `npm run seed` | Insert seed candidate data into the database |
