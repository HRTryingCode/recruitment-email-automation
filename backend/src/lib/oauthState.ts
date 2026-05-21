// Persistent OAuth state store for CSRF protection on the Gmail connect flow.
// Shared between the route that initiates OAuth (routes/mailboxes.ts) and the
// callback handler (registered directly on the app in app.ts because Google's
// OAuth redirect cannot carry a JWT).
//
// Backed by the `OAuthState` Prisma table (migration 7_oauth_state). An earlier
// version used an in-process Map, but Vercel function instances don't share
// memory — a callback landing on a different instance from auth-init would
// reject as "invalid state". Persisting the state in Postgres makes the CSRF
// check reliable regardless of which serverless instance handles each leg.
//
// Each row's lifetime: insert at /gmail/auth, optionally update consumedAt at
// /gmail/callback, get reaped opportunistically (rows older than the 10-minute
// TTL) on the next insert. One-time-use is enforced by checking consumedAt.

import { prisma } from '../db/client';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export async function storeOAuthState(state: string): Promise<void> {
  const cutoff = new Date(Date.now() - OAUTH_STATE_TTL_MS);
  // Opportunistic reaper: keep the table bounded without a dedicated cron.
  // Failure here is non-fatal — the insert below is what callers depend on.
  try {
    await prisma.oAuthState.deleteMany({ where: { createdAt: { lt: cutoff } } });
  } catch (err) {
    console.warn('[oauthState] reaper failed (non-fatal):', err);
  }
  await prisma.oAuthState.create({ data: { state } });
}

export async function consumeOAuthState(state: string): Promise<boolean> {
  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (!row) return false;
  if (row.consumedAt) return false; // one-time use — protect against replay
  if (row.createdAt.getTime() + OAUTH_STATE_TTL_MS < Date.now()) return false;
  // Mark consumed; if a concurrent callback also marks it, the second
  // findUnique above would already have observed consumedAt and rejected.
  await prisma.oAuthState.update({
    where: { state },
    data: { consumedAt: new Date() },
  });
  return true;
}
