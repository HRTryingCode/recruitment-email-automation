// Audit B6 / L9: boot validation must agree with lib/crypto — exactly 32 bytes.
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('config ENCRYPTION_KEY validation (L9)', () => {
  const saved = process.env.ENCRYPTION_KEY;
  afterEach(() => {
    process.env.ENCRYPTION_KEY = saved;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('flags a 48-byte key (previously accepted at boot, then failed at runtime)', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(48, 1).toString('base64');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    await import('../src/config');
    expect(warn.mock.calls.some((c) => /ENCRYPTION_KEY must decode to exactly 32 bytes/.test(String(c[0])))).toBe(true);
  });

  it('accepts a 32-byte key', async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    await import('../src/config');
    expect(warn.mock.calls.some((c) => /ENCRYPTION_KEY/.test(String(c[0])))).toBe(false);
  });
});
