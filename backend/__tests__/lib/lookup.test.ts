import { describe, it, expect } from 'vitest';
import {
  normalizeLookupEmail,
  addressListContains,
  summarizeMessages,
  computeVerdict,
  formatShortDate,
} from '../../src/lib/lookup';

const NOW = new Date('2026-10-22T12:00:00Z');

describe('normalizeLookupEmail', () => {
  it('trims and lowercases a valid email', () => {
    expect(normalizeLookupEmail('  Arron@ArronGould.com ')).toBe('arron@arrongould.com');
  });

  it.each([
    ['empty', ''],
    ['no at', 'arron'],
    ['partial', 'arron@'],
    ['spaces inside', 'a b@c.com'],
    ['too long', `${'a'.repeat(250)}@x.com`],
    ['array', ['a@b.com', 'c@d.com']],
    ['undefined', undefined],
  ])('rejects %s', (_label, raw) => {
    expect(normalizeLookupEmail(raw)).toBeNull();
  });
});

describe('addressListContains', () => {
  it('matches a bare address case-insensitively', () => {
    expect(addressListContains('["Bob@X.com","c@d.com"]', 'bob@x.com')).toBe(true);
  });

  it('matches a "Name <addr>" fragment', () => {
    expect(addressListContains('["\\"Gould, Arron\\" <arron@arrongould.com>"]', 'arron@arrongould.com')).toBe(true);
  });

  it('does not match a longer address that contains the email as a substring', () => {
    expect(addressListContains('["jimbob@x.com"]', 'bob@x.com')).toBe(false);
  });

  it('handles comma-joined fragments inside one entry', () => {
    expect(addressListContains('["a@b.com, Bob <bob@x.com>"]', 'bob@x.com')).toBe(true);
  });

  it('returns false for malformed JSON', () => {
    expect(addressListContains('not json', 'bob@x.com')).toBe(false);
  });
});

describe('summarizeMessages', () => {
  const rows = [
    {
      mailboxId: 'mb-1',
      fromAddress: 'paul.b@archive.com',
      toAddresses: '["bob@x.com"]',
      subject: 'Role at Archive',
      receivedAt: new Date('2026-10-03T10:00:00Z'),
      processingState: 'PROCESSED',
      externalMessageId: 'g-1',
      threadId: 't-1',
    },
    {
      mailboxId: 'mb-2',
      fromAddress: 'BOB@x.com',
      toAddresses: '["paul.b@archive.com"]',
      subject: 'Re: Role at Archive',
      receivedAt: new Date('2026-10-05T10:00:00Z'),
      processingState: 'SKIPPED',
      externalMessageId: 'g-2',
      threadId: 't-1',
    },
    {
      // substring false-positive from the DB prefilter — must be dropped
      mailboxId: 'mb-1',
      fromAddress: 'jimbob@x.com',
      toAddresses: '["paul.b@archive.com"]',
      subject: 'noise',
      receivedAt: new Date('2026-10-10T10:00:00Z'),
      processingState: 'PROCESSED',
      externalMessageId: 'g-3',
      threadId: 't-9',
    },
  ];

  it('counts inbound/outbound, dates, mailboxes and latest subject', () => {
    const s = summarizeMessages(rows, 'bob@x.com');
    expect(s.inbound).toBe(1);
    expect(s.outbound).toBe(1);
    expect(s.firstAt?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
    expect(s.lastAt?.toISOString()).toBe('2026-10-05T10:00:00.000Z');
    expect(s.mailboxIds.sort()).toEqual(['mb-1', 'mb-2']);
    expect(s.latestSubject).toBe('Re: Role at Archive');
    expect(s.lastOutbound?.fromAddress).toBe('paul.b@archive.com');
    expect(s.lastInbound?.externalMessageId).toBe('g-2');
    expect(s.threadIds).toEqual(['t-1']);
    expect(s.inboundSkippedByFilter).toBe(1);
  });

  it('returns zeros for no rows', () => {
    const s = summarizeMessages([], 'bob@x.com');
    expect(s).toMatchObject({ inbound: 0, outbound: 0, firstAt: null, lastAt: null, latestSubject: null });
  });
});

describe('formatShortDate', () => {
  it('omits the year for the current year', () => {
    expect(formatShortDate(new Date('2026-10-03T10:00:00Z'), NOW)).toBe('3 Oct');
  });
  it('includes the year for other years', () => {
    expect(formatShortDate(new Date('2025-01-15T10:00:00Z'), NOW)).toBe('15 Jan 2025');
  });
});

describe('computeVerdict', () => {
  const empty = summarizeMessages([], 'bob@x.com');

  it('CANDIDATE when a candidate row exists', () => {
    const v = computeVerdict({
      candidate: { name: 'Bob', status: 'INTERESTED', role: 'Senior Engineer', mailboxEmail: 'paul.b@archive.com' },
      messages: empty,
      skipped: [],
      now: NOW,
    });
    expect(v.verdict).toBe('CANDIDATE');
    expect(v.summary).toBe('Candidate (Interested) for Senior Engineer — via paul.b@');
  });

  it('CONTACTED_NO_REPLY when we only emailed them', () => {
    const v = computeVerdict({
      candidate: null,
      messages: {
        ...empty,
        outbound: 1,
        lastOutbound: { fromAddress: 'paul.b@archive.com', receivedAt: new Date('2026-10-03T10:00:00Z') },
      },
      skipped: [],
      now: NOW,
    });
    expect(v.verdict).toBe('CONTACTED_NO_REPLY');
    expect(v.summary).toBe('We emailed them from paul.b@ on 3 Oct — no reply yet');
  });

  it('REPLIED_NOT_CANDIDATE with the skip reason when they replied but were skipped', () => {
    const v = computeVerdict({
      candidate: null,
      messages: {
        ...empty,
        inbound: 1,
        lastInbound: { externalMessageId: 'g-2', receivedAt: new Date('2026-10-05T10:00:00Z'), mailboxEmail: 'paul.b@archive.com' },
      },
      skipped: ['NOT_RECRUITING'],
      now: NOW,
    });
    expect(v.verdict).toBe('REPLIED_NOT_CANDIDATE');
    expect(v.summary).toBe(
      'They wrote to paul.b@ on 5 Oct — skipped as not recruiting-related'
    );
  });

  it('REPLIED_NOT_CANDIDATE without a known reason', () => {
    const v = computeVerdict({
      candidate: null,
      messages: { ...empty, inbound: 2, lastInbound: { externalMessageId: 'g', receivedAt: new Date('2026-10-05T10:00:00Z'), mailboxEmail: null } },
      skipped: [],
      now: NOW,
    });
    expect(v.summary).toBe('They wrote to us on 5 Oct — not classified as a candidate');
  });

  it('UNKNOWN when nothing is known', () => {
    const v = computeVerdict({ candidate: null, messages: empty, skipped: [], now: NOW });
    expect(v.verdict).toBe('UNKNOWN');
    expect(v.summary).toBe('No trace of this email in any connected mailbox');
  });
});
