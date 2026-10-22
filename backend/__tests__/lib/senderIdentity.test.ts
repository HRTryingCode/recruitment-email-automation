import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  mailboxOwnAddresses,
  isMailboxOwnAddress,
  isInternalAddress,
  sendAsEmailsFromGmail,
} from '../../src/lib/senderIdentity';

// M11: outbound/internal detection must not be exact-address equality.

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Ethan@Archive.COM ')).toBe('ethan@archive.com');
  });
});

describe('mailboxOwnAddresses', () => {
  it('returns the primary address plus sendAs aliases, normalized and deduped', () => {
    expect(
      mailboxOwnAddresses({
        emailAddress: 'EMaenza@archive.com',
        sendAsAddresses: ['ethan@archive.com', 'emaenza@archive.com', ' Ethan@archive.com'],
      })
    ).toEqual(['emaenza@archive.com', 'ethan@archive.com']);
  });

  it('tolerates a mailbox row without sendAsAddresses (pre-migration shape)', () => {
    expect(mailboxOwnAddresses({ emailAddress: 'a@archive.com' })).toEqual(['a@archive.com']);
  });
});

describe('isMailboxOwnAddress', () => {
  const mailbox = { emailAddress: 'emaenza@archive.com', sendAsAddresses: ['ethan@archive.com'] };

  it('matches the primary address case-insensitively', () => {
    expect(isMailboxOwnAddress(mailbox, 'EMAENZA@archive.com')).toBe(true);
  });

  it('matches a sendAs alias', () => {
    expect(isMailboxOwnAddress(mailbox, 'Ethan@Archive.com')).toBe(true);
  });

  it('does not match a colleague', () => {
    expect(isMailboxOwnAddress(mailbox, 'sofia@archive.com')).toBe(false);
  });

  it('does not match an empty address', () => {
    expect(isMailboxOwnAddress(mailbox, '')).toBe(false);
  });
});

describe('isInternalAddress', () => {
  it('is true for the configured internal domain regardless of case', () => {
    expect(isInternalAddress('P.Benigeri@ARCHIVE.com', ['archive.com'])).toBe(true);
  });

  it('is false for a lookalike domain', () => {
    expect(isInternalAddress('someone@notarchive.com', ['archive.com'])).toBe(false);
    expect(isInternalAddress('someone@archive.com.evil.io', ['archive.com'])).toBe(false);
  });

  it('is false for external candidates', () => {
    expect(isInternalAddress('candidate@gmail.com', ['archive.com'])).toBe(false);
  });

  it('honours multiple domains', () => {
    expect(isInternalAddress('x@archive.dev', ['archive.com', 'archive.dev'])).toBe(true);
  });
});

describe('sendAsEmailsFromGmail', () => {
  it('extracts normalized sendAsEmail values, dropping blanks', () => {
    expect(
      sendAsEmailsFromGmail([
        { sendAsEmail: 'Paul.Benigeri@archive.com', isPrimary: true },
        { sendAsEmail: 'p.benigeri@archive.com' },
        { sendAsEmail: null },
        {},
      ])
    ).toEqual(['paul.benigeri@archive.com', 'p.benigeri@archive.com']);
  });

  it('returns [] for undefined', () => {
    expect(sendAsEmailsFromGmail(undefined)).toEqual([]);
  });
});
