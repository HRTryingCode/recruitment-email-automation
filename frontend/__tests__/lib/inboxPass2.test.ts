// U1b helpers: empty hints, lock copy, expiry, page merge, new-reply delta, live summaries.
import { describe, expect, it } from 'vitest';
import { VIEWS, expiresIn, itemKey, liveSummary, lockWarning, mergePages, newReplyDelta } from '../../src/lib/inbox';
import { item } from '../components/inbox/fixtures';

const H = 3600_000;

describe('VIEWS hints', () => {
  it('every view has its own empty-state hint', () => {
    const hints = VIEWS.map((v) => v.hint);
    expect(hints.every((h) => h.length > 0)).toBe(true);
    expect(new Set(hints).size).toBe(VIEWS.length);
    expect(VIEWS.find((v) => v.id === 'snoozed')!.hint).toBe('Press S on a reply to bring it back later.');
  });
});

describe('lockWarning', () => {
  it.each([
    ['Send anyway', 'Sending now may overwrite their changes.'],
    ['Dismiss anyway', 'Dismissing now may overwrite their changes.'],
    ['Rewrite anyway', 'Rewriting now may overwrite their changes.'],
    ['Regenerate anyway', 'Regenerating now may overwrite their changes.'],
    ['Change anyway', 'Changing the CC now may overwrite their changes.'],
    ['Restore anyway', 'Restoring now may overwrite their changes.'],
  ])('%s → %s', (label, text) => {
    expect(lockWarning(label)).toBe(text);
  });
});

describe('expiresIn', () => {
  const now = Date.parse('2026-10-22T12:00:00Z');
  const at = (ms: number) => new Date(now + ms).toISOString();
  it('says days when two or more days are left', () => {
    expect(expiresIn(at(2 * 24 * H + 1000), now)).toBe('Expires in 2d');
  });
  it('says hours inside the last day', () => {
    expect(expiresIn(at(5 * H + 1000), now)).toBe('Expires in 5h');
  });
  it('says "Expires soon" inside the last hour', () => {
    expect(expiresIn(at(10 * 60_000), now)).toBe('Expires soon');
  });
  it('is silent when more than 3 days are left, already past, or unknown', () => {
    expect(expiresIn(at(4 * 24 * H), now)).toBeNull();
    expect(expiresIn(at(-1000), now)).toBeNull();
    expect(expiresIn(null, now)).toBeNull();
    expect(expiresIn(undefined, now)).toBeNull();
  });
});

describe('mergePages', () => {
  it('concatenates pages and drops an item repeated across a page boundary', () => {
    const a = item('d1', 'interested');
    const b = item('d2', 'interested');
    const c = item('d3', 'interested');
    expect(mergePages([[a, b], [b, c]]).map(itemKey)).toEqual(['d1', 'd2', 'd3']);
  });
});

describe('newReplyDelta', () => {
  const counts = (n: number, i: number, x: number, snoozed = 0, sent = 0) => ({
    needs_review: n,
    interested: i,
    not_interested: x,
    snoozed,
    sent_today: sent,
  });
  it('is 0 without a baseline', () => {
    expect(newReplyDelta(null, counts(1, 1, 1))).toBe(0);
  });
  it('sums growth over the three live views', () => {
    expect(newReplyDelta(counts(1, 1, 1), counts(2, 2, 1))).toBe(2);
  });
  it('ignores snoozed and sent, and never goes negative', () => {
    expect(newReplyDelta(counts(1, 1, 1), counts(1, 1, 1, 5, 5))).toBe(0);
    expect(newReplyDelta(counts(3, 1, 1), counts(1, 1, 1))).toBe(0);
  });
});

describe('liveSummary', () => {
  it('names what was done and what opened next', () => {
    expect(liveSummary('Sent to Ana', 'Ben')).toBe('Sent to Ana. Opened Ben.');
    expect(liveSummary('Dismissed Ana')).toBe('Dismissed Ana.');
  });
});
