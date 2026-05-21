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

  it('emits a 3-part `iv:authTag:ciphertext` payload', () => {
    const payload = encrypt('x');
    const parts = payload.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((p) => expect(p.length).toBeGreaterThan(0));
  });

  describe('tamper rejection', () => {
    it('throws when the ciphertext is mutated', () => {
      const [iv, tag, ct] = encrypt('payload').split(':');
      // Flip the last byte of the ciphertext.
      const ctBuf = Buffer.from(ct, 'base64');
      ctBuf[ctBuf.length - 1] ^= 0x01;
      const tampered = `${iv}:${tag}:${ctBuf.toString('base64')}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws when the authTag is mutated', () => {
      const [iv, tag, ct] = encrypt('payload').split(':');
      const tagBuf = Buffer.from(tag, 'base64');
      tagBuf[0] ^= 0x01;
      const tampered = `${iv}:${tagBuf.toString('base64')}:${ct}`;
      expect(() => decrypt(tampered)).toThrow();
    });

    it('throws when the IV is mutated', () => {
      const [iv, tag, ct] = encrypt('payload').split(':');
      const ivBuf = Buffer.from(iv, 'base64');
      ivBuf[0] ^= 0x01;
      const tampered = `${ivBuf.toString('base64')}:${tag}:${ct}`;
      expect(() => decrypt(tampered)).toThrow();
    });
  });

  describe('malformed payload rejection', () => {
    it('throws on a payload without three parts', () => {
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
