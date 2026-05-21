import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';

import {
  hashPassword,
  verifyPassword,
  issueToken,
  verifyToken,
} from '../../src/services/auth.service';
import { config } from '../../src/config';

describe('services/auth.service', () => {
  describe('hashPassword / verifyPassword', () => {
    it('hashes a password to something distinct from the plaintext', async () => {
      const hash = await hashPassword('hunter2');
      expect(hash).not.toBe('hunter2');
      // bcrypt hashes start with $2a$, $2b$, or $2y$ followed by cost
      expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    });

    it('produces a different hash each call (random salt)', async () => {
      const a = await hashPassword('same-password');
      const b = await hashPassword('same-password');
      expect(a).not.toBe(b);
    });

    it('verifies the correct password and rejects the wrong one', async () => {
      const hash = await hashPassword('correct horse battery staple');
      await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
      await expect(verifyPassword('Tr0ub4dor&3', hash)).resolves.toBe(false);
    });
  });

  describe('issueToken / verifyToken', () => {
    it('issues a JWT carrying the userId', () => {
      const token = issueToken('user-abc-123');
      expect(typeof token).toBe('string');
      // JWT shape: three base64url segments separated by dots.
      expect(token.split('.')).toHaveLength(3);

      const decoded = jwt.verify(token, config.jwtSecret) as { userId?: string };
      expect(decoded.userId).toBe('user-abc-123');
    });

    it('round-trips: verifyToken(issueToken(x)) === { userId: x }', () => {
      const token = issueToken('roundtrip-user');
      expect(verifyToken(token)).toEqual({ userId: 'roundtrip-user' });
    });

    it('returns null for garbage tokens', () => {
      expect(verifyToken('garbage')).toBeNull();
      expect(verifyToken('')).toBeNull();
      expect(verifyToken('not.a.jwt')).toBeNull();
    });

    it('returns null for a token signed with a different secret', () => {
      const foreign = jwt.sign({ userId: 'x' }, 'a-different-secret');
      expect(verifyToken(foreign)).toBeNull();
    });

    it('returns null when the token payload lacks a string userId', () => {
      // Token signed with the correct secret but missing `userId` field.
      const token = jwt.sign({ notUserId: 'oops' }, config.jwtSecret);
      expect(verifyToken(token)).toBeNull();
    });

    it('returns null for an expired token', () => {
      // Forge an already-expired token signed with the real secret. This
      // avoids monkey-patching the SUT's hardcoded `7d` expiry.
      const expired = jwt.sign({ userId: 'expired-user' }, config.jwtSecret, {
        expiresIn: -10, // expired 10 seconds ago
      });
      expect(verifyToken(expired)).toBeNull();
    });
  });
});
