// In-memory OAuth state store for CSRF protection.
// Shared between the route that initiates OAuth (routes/mailboxes.ts) and the
// callback handler (registered directly on the app in app.ts because Google's
// OAuth redirect cannot carry a JWT). 10-minute TTL prevents stale entries
// from accumulating.
//
// Vercel-serverless caveat: each function invocation may run in a separate
// instance, and the in-memory Map is not shared between them. In practice
// warm-start reuse means the state issued at /api/mailboxes/gmail/auth is
// usually still present when the callback fires a few seconds later, but
// cold-start mismatches do happen — users see "Invalid or expired OAuth state"
// and have to retry. We've left this in place because the failure mode is a
// loud, recoverable UX bump (one extra click) rather than a security hole;
// migrating to Redis/Upstash KV is the production-grade fix and is tracked
// in docs/OPERATIONS.md under "OAuth state storage".

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const oauthStateStore = new Map<string, number>();

export function storeOAuthState(state: string): void {
  // Opportunistic cleanup of expired entries.
  const now = Date.now();
  for (const [key, expiresAt] of oauthStateStore) {
    if (expiresAt < now) oauthStateStore.delete(key);
  }
  oauthStateStore.set(state, now + OAUTH_STATE_TTL_MS);
}

export function consumeOAuthState(state: string): boolean {
  const expiresAt = oauthStateStore.get(state);
  if (!expiresAt) return false;
  oauthStateStore.delete(state); // one-time use
  return expiresAt >= Date.now();
}
