import { describe, it, expect } from 'vitest';
import {
  suggestPosting,
  mailboxTag,
  replyExcerpt,
  buildNoteText,
  buildHeadline,
} from '../../src/services/addToLever.service';
import type { LeverPosting } from '../../src/services/leverWrite.service';

const P = (id: string, title: string, state = 'published'): LeverPosting => ({ id, title, team: null, location: null, state });

describe('suggestPosting (Candidate.role → open posting)', () => {
  const postings = [P('p1', 'Founding Engineer'), P('p2', 'Backend Engineer'), P('p3', 'Product Designer'), P('p4', 'Backend Engineer', 'internal')];

  it('exact title match, case/punctuation-insensitive', () => {
    expect(suggestPosting('founding engineer', postings)?.id).toBe('p1');
    expect(suggestPosting('Founding Engineer!', postings)?.id).toBe('p1');
  });

  it('prefers a published posting over an internal one with the same title', () => {
    expect(suggestPosting('Backend Engineer', postings)?.id).toBe('p2');
  });

  it('containment: a seniority prefix still matches', () => {
    expect(suggestPosting('Senior Backend Engineer', postings)?.id).toBe('p2');
  });

  it('strong token overlap matches; weak overlap does not', () => {
    expect(suggestPosting('Designer, Product', postings)?.id).toBe('p3');
    expect(suggestPosting('Sales Engineer', postings)).toBeNull();
  });

  it('no role or no postings → null', () => {
    expect(suggestPosting(null, postings)).toBeNull();
    expect(suggestPosting('  ', postings)).toBeNull();
    expect(suggestPosting('Founding Engineer', [])).toBeNull();
  });
});

describe('mailboxTag', () => {
  it('is the mailbox local-part, lowercased', () => {
    expect(mailboxTag('Paul.B@archive.com')).toBe('paul.b');
    expect(mailboxTag(null)).toBeNull();
    expect(mailboxTag('not-an-address')).toBeNull();
  });
});

describe('buildHeadline', () => {
  it('"Title at Company", either part alone, or null', () => {
    expect(buildHeadline('Staff Engineer', 'Acme')).toBe('Staff Engineer at Acme');
    expect(buildHeadline('Staff Engineer', null)).toBe('Staff Engineer');
    expect(buildHeadline(null, 'Acme')).toBe('Acme');
    expect(buildHeadline(null, null)).toBeNull();
  });
});

describe('replyExcerpt', () => {
  it('drops quoted history and signatures, collapses whitespace', () => {
    const body = 'Sounds great,\n\nhappy to chat next week.\n\nOn Mon, Oct 20, 2026 at 9:00 AM Paul <paul.b@archive.com> wrote:\n> Hi Jane\n> ...';
    expect(replyExcerpt(body)).toBe('Sounds great, happy to chat next week.');
  });

  it('stops at "> " lines and Original Message separators', () => {
    expect(replyExcerpt('Yes!\n> quoted')).toBe('Yes!');
    expect(replyExcerpt('Sure\n-----Original Message-----\nFrom: x')).toBe('Sure');
  });

  it('caps at 500 chars with an ellipsis', () => {
    const out = replyExcerpt('word '.repeat(300))!;
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.endsWith('…')).toBe(true);
  });

  it('null/empty → null', () => {
    expect(replyExcerpt(null)).toBeNull();
    expect(replyExcerpt('  \n ')).toBeNull();
  });
});

describe('buildNoteText', () => {
  it('has who added it, the app conversation link, a Gmail link and the reply excerpt', () => {
    const text = buildNoteText({
      actorEmail: 'paul.b@archive.com',
      appUrl: 'https://app.test',
      candidateEmail: 'jane@example.com',
      gmailUrl: 'https://mail.google.com/mail/?authuser=paul.b%40archive.com#all/t1',
      reply: { text: 'Sounds great', at: new Date('2026-10-20T09:00:00Z') },
    });
    expect(text).toContain('Added from Recruiting Email Automation by paul.b@archive.com');
    expect(text).toContain('https://app.test/?tab=candidates&q=jane%40example.com');
    expect(text).toContain('https://mail.google.com/mail/?authuser=paul.b%40archive.com#all/t1');
    expect(text).toContain('Latest reply (2026-10-20):');
    expect(text).toContain('Sounds great');
  });

  it('without a reply says so', () => {
    const text = buildNoteText({ actorEmail: 'a@archive.com', appUrl: 'https://app.test', candidateEmail: 'x@y.com', gmailUrl: null, reply: null });
    expect(text).not.toContain('Latest reply');
    expect(text).not.toContain('Gmail');
  });
});
