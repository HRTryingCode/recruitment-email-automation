import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

import { encrypt, decrypt } from '../../src/lib/crypto';

const VALID_KEY_B64 = crypto.randomBytes(32).toString('base64');

describe('lib/crypto', () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = VALID_KEY_B64;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a plaintext through encrypt → decrypt', () => {
    const plaintext = 'hello world — refresh-token-style payload';
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it('handles non-ASCII / unicode payloads', () => {
    const plaintext = 'résumé 📧 — naïve über';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('produces a different ciphertext each call (IV randomness)', () => {
    const plaintext = 'same message';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
    // Both still decrypt to the same plaintext.
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });

  it('emits a key-versioned `v1:iv:authTag:ciphertext` payload (L9)', () => {
    const payload = encrypt('x');
    const parts = payload.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });

  describe('key versioning + rotation (L9)', () => {
    const OLD_KEY = crypto.randomBytes(32).toString('base64');
    const NEW_KEY = crypto.randomBytes(32).toString('base64');
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of ['ENCRYPTION_KEY_VERSION', 'ENCRYPTION_KEY_PREVIOUS']) saved[k] = process.env[k];
      delete process.env.ENCRYPTION_KEY_VERSION;
      delete process.env.ENCRYPTION_KEY_PREVIOUS;
    });
    afterEach(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    function legacyEncrypt(plaintext: string, keyB64: string): string {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
      const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
      return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join(':');
    }

    it('still decrypts legacy unversioned payloads (all prod rows today)', () => {
      expect(decrypt(legacyEncrypt('legacy-token', VALID_KEY_B64))).toBe('legacy-token');
    });

    it('after rotation, decrypts v1 and legacy payloads with ENCRYPTION_KEY_PREVIOUS and writes v2', () => {
      process.env.ENCRYPTION_KEY = OLD_KEY;
      const v1 = encrypt('old-token');
      const legacy = legacyEncrypt('older-token', OLD_KEY);

      process.env.ENCRYPTION_KEY = NEW_KEY;
      process.env.ENCRYPTION_KEY_VERSION = '2';
      process.env.ENCRYPTION_KEY_PREVIOUS = OLD_KEY;

      expect(decrypt(v1)).toBe('old-token');
      expect(decrypt(legacy)).toBe('older-token');
      const v2 = encrypt('new-token');
      expect(v2.startsWith('v2:')).toBe(true);
      expect(decrypt(v2)).toBe('new-token');
    });

    it('throws for a version with no matching key', () => {
      process.env.ENCRYPTION_KEY = OLD_KEY;
      const v1 = encrypt('t');
      process.env.ENCRYPTION_KEY = NEW_KEY;
      process.env.ENCRYPTION_KEY_VERSION = '2';
      expect(() => decrypt(v1)).toThrow(/no key configured for version v1/i);
    });

    it('rejects a malformed version tag', () => {
      process.env.ENCRYPTION_KEY_VERSION = 'abc';
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY_VERSION/);
    });
  });

  describe('tamper rejection', () => {
    it('throws when the ciphertext is mutated', () => {
      const [ver, iv, tag, ct] = encrypt('payload').split(':');
      // Flip the last byte of the ciphertext.
      const ctBuf = Buffer.from(ct, 'base64');
      ctBuf[ctBuf.length - 1] ^= 0x01;
      const tampered = `${ver}:${iv}:${tag}:${ctBuf.toString('base64')}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws when the authTag is mutated', () => {
      const [ver, iv, tag, ct] = encrypt('payload').split(':');
      const tagBuf = Buffer.from(tag, 'base64');
      tagBuf[0] ^= 0x01;
      const tampered = `${ver}:${iv}:${tagBuf.toString('base64')}:${ct}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws when the IV is mutated', () => {
      const [ver, iv, tag, ct] = encrypt('payload').split(':');
      const ivBuf = Buffer.from(iv, 'base64');
      ivBuf[0] ^= 0x01;
      const tampered = `${ver}:${ivBuf.toString('base64')}:${tag}:${ct}`;
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('malformed payload rejection', () => {
    it('throws on a payload without three (legacy) or four (versioned) parts', () => {
      expect(() => decrypt('not:a-valid-payload')).toThrow(
        /Invalid encrypted payload format/
      );
      expect(() => decrypt('still-not-valid')).toThrow(
        /Invalid encrypted payload format/
      );
    });

    it('throws on an IV of the wrong length', () => {
      const wrongIv = Buffer.alloc(8).toString('base64'); // 8 bytes, not 12
      const tag = Buffer.alloc(16).toString('base64');
      const ct = Buffer.from('garbage').toString('base64');
      expect(() => decrypt(`${wrongIv}:${tag}:${ct}`)).toThrow(/Invalid IV length/);
      expect(() => decrypt(`v1:${wrongIv}:${tag}:${ct}`)).toThrow(/Invalid IV length/);
    });
  });

  describe('key validation', () => {
    it('throws when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY .* not set/);
      expect(() => decrypt('a:b:c')).toThrow(/ENCRYPTION_KEY .* not set/);
    });

    it('throws when ENCRYPTION_KEY is the wrong length', () => {
      process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString('base64'); // 128 bits
      expect(() => encrypt('x')).toThrow(/must decode to 32 bytes/);
    });
  });
});
