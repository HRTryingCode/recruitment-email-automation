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
// TTL) on the next insert. One-time-use is enforced atomically: a single
// conditional updateMany on (state, consumedAt IS NULL, fresh) — exactly one
// concurrent callback can flip consumedAt.
//
// Binding (audit B6 / L6): the state string is `<64 hex>.<userId>`. The full
// string is stored server-side, so the userId suffix can't be forged — the
// callback only succeeds for a state we issued — and it lets the callback
// attribute the connect to (and authorize it for) the user who started it,
// without a schema change.

import crypto from 'crypto';
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

export async function createOAuthState(userId: string): Promise<string> {
  const state = `${crypto.randomBytes(32).toString('hex')}.${userId}`;
  await storeOAuthState(state);
  return state;
}

export async function consumeOAuthState(
  state: string
): Promise<{ userId: string | null } | null> {
  const cutoff = new Date(Date.now() - OAUTH_STATE_TTL_MS);
  const { count } = await prisma.oAuthState.updateMany({
    where: { state, consumedAt: null, createdAt: { gte: cutoff } },
    data: { consumedAt: new Date() },
  });
  if (count !== 1) return null;
  const dot = state.indexOf('.');
  return { userId: dot >= 0 ? state.slice(dot + 1) || null : null };
}
