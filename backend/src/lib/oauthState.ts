// In-memory OAuth state store for CSRF protection.
// NOTE: survives single-instance only; move to Redis for multi-instance prod.
// 10-minute TTL prevents stale entries from accumulating.
//
// Shared between the route that initiates OAuth (routes/mailboxes.ts) and the
// callback handler (registered directly on the app in app.ts because Google's
// OAuth redirect cannot carry a JWT).

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
