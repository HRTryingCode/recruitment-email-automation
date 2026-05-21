import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { storeOAuthState, consumeOAuthState } from '../../src/lib/oauthState';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

describe('lib/oauthState', () => {
  beforeEach(() => {
    // The store is module-level; isolate each test by using unique tokens.
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('consumes a stored state exactly once', () => {
    const token = `tok-${Math.random()}`;
    storeOAuthState(token);
    expect(consumeOAuthState(token)).toBe(true);
    // Second consume is a no-op — protects against replay.
    expect(consumeOAuthState(token)).toBe(false);
  });

  it('returns false for an unknown token', () => {
    expect(consumeOAuthState(`never-stored-${Math.random()}`)).toBe(false);
  });

  it('treats expired tokens as invalid', () => {
    vi.useFakeTimers();
    const token = `tok-${Math.random()}`;
    storeOAuthState(token);
    // Jump past the TTL.
    vi.advanceTimersByTime(OAUTH_STATE_TTL_MS + 1);
    expect(consumeOAuthState(token)).toBe(false);
  });

  it('still accepts a token consumed just before TTL elapses', () => {
    vi.useFakeTimers();
    const token = `tok-${Math.random()}`;
    storeOAuthState(token);
    vi.advanceTimersByTime(OAUTH_STATE_TTL_MS - 1);
    expect(consumeOAuthState(token)).toBe(true);
  });

  it('isolates tokens — consuming one does not affect another', () => {
    const a = `tok-a-${Math.random()}`;
    const b = `tok-b-${Math.random()}`;
    storeOAuthState(a);
    storeOAuthState(b);
    expect(consumeOAuthState(a)).toBe(true);
    expect(consumeOAuthState(b)).toBe(true);
    expect(consumeOAuthState(a)).toBe(false);
    expect(consumeOAuthState(b)).toBe(false);
  });
});
