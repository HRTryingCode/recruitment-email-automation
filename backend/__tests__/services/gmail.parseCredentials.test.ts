// Audit B6 / L9: no plaintext fallback — a credential that fails to decrypt
// is an error, not silently parsed as JSON or replaced with {}.
import { describe, it, expect, vi } from 'vitest';
import { buildPrismaMock } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { parseCredentials, serializeCredentials } from '../../src/services/gmail.service';
import type { Mailbox } from '@prisma/client';

function mb(credentials: string): Mailbox {
  return { id: 'mb-1', credentials } as unknown as Mailbox;
}

describe('parseCredentials (L9)', () => {
  it('round-trips encrypted credentials', () => {
    const enc = serializeCredentials({ refresh_token: 'rt' });
    expect(parseCredentials(mb(enc))).toEqual({ refresh_token: 'rt' });
  });

  it('throws on plaintext JSON credentials instead of accepting them', () => {
    expect(() => parseCredentials(mb('{"refresh_token":"rt"}'))).toThrow(/decrypt/i);
  });

  it('throws on undecryptable ciphertext instead of returning {}', () => {
    const enc = serializeCredentials({ refresh_token: 'rt' });
    const broken = enc.slice(0, -4) + (enc.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(() => parseCredentials(mb(broken))).toThrow(/decrypt/i);
  });

  it('never includes the credential payload in the error message', () => {
    try {
      parseCredentials(mb('{"refresh_token":"super-secret-rt"}'));
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('super-secret-rt');
    }
  });
});
