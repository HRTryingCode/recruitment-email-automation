// H2: Lever webhook signatures. Per Lever's docs: hex HMAC-SHA256 of
// `token + triggeredAt`, keyed with the webhook's signature token.
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('../../src/db/client', () => ({ prisma: {}, default: {} }));

import {
  LEVER_WEBHOOK_MAX_SKEW_MS,
  parseSignatureTokens,
  verifyLeverSignature,
} from '../../src/services/leverRealtime.service';

const NOW = 1_790_000_000_000;
const sign = (key: string, token: string, triggeredAt: number) =>
  createHmac('sha256', key).update(`${token}${triggeredAt}`).digest('hex');
function body(key: string, triggeredAt = NOW - 1000, token = 'tok-abc') {
  return { token, triggeredAt, signature: sign(key, token, triggeredAt) };
}

describe('parseSignatureTokens', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(parseSignatureTokens(' a , b,,c ')).toEqual(['a', 'b', 'c']);
    expect(parseSignatureTokens(undefined)).toEqual([]);
    expect(parseSignatureTokens('  ')).toEqual([]);
  });
});

describe('verifyLeverSignature', () => {
  it('accepts a valid signature', () => {
    expect(verifyLeverSignature(body('k1'), ['k1'], NOW)).toEqual({ ok: true });
  });

  it('accepts a signature made with any configured token (one per webhook)', () => {
    expect(verifyLeverSignature(body('k2'), ['k1', 'k2', 'k3'], NOW)).toEqual({ ok: true });
  });

  it('rejects a signature made with an unknown token', () => {
    expect(verifyLeverSignature(body('nope'), ['k1', 'k2'], NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects when triggeredAt was tampered with', () => {
    const b = { ...body('k1'), triggeredAt: NOW - 500 };
    expect(verifyLeverSignature(b, ['k1'], NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a stale triggeredAt (older than 5 min) even when correctly signed', () => {
    const b = body('k1', NOW - LEVER_WEBHOOK_MAX_SKEW_MS - 60_000);
    expect(verifyLeverSignature(b, ['k1'], NOW)).toEqual({ ok: false, reason: 'stale' });
    expect(LEVER_WEBHOOK_MAX_SKEW_MS).toBe(5 * 60 * 1000);
  });

  it('rejects a triggeredAt more than 5 min in the future', () => {
    const b = body('k1', NOW + LEVER_WEBHOOK_MAX_SKEW_MS + 60_000);
    expect(verifyLeverSignature(b, ['k1'], NOW)).toEqual({ ok: false, reason: 'stale' });
  });

  it('accepts triggeredAt sent as a numeric string', () => {
    const b = body('k1');
    expect(verifyLeverSignature({ ...b, triggeredAt: String(b.triggeredAt) }, ['k1'], NOW)).toEqual({ ok: true });
  });

  it('rejects missing or malformed fields without throwing', () => {
    const b = body('k1');
    for (const bad of [
      {},
      { ...b, token: undefined },
      { ...b, signature: undefined },
      { ...b, triggeredAt: 'soon' },
      { ...b, signature: 'abc' }, // wrong length
      { ...b, signature: 42 },
    ]) {
      const r = verifyLeverSignature(bad as never, ['k1'], NOW);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects everything when no tokens are configured', () => {
    expect(verifyLeverSignature(body('k1'), [], NOW).ok).toBe(false);
  });
});
