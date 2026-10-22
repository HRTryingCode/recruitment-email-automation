import { describe, expect, it } from 'vitest';
import {
  VIEWS,
  customSnooze,
  diffWords,
  draftedLine,
  formatAge,
  highlightSegments,
  labelFor,
  nextItemId,
  sendLine,
  snoozePresets,
  viewForClass,
} from '../../src/lib/inbox';

describe('labelFor', () => {
  it('names labels in words with a semantic tone', () => {
    expect(labelFor('INTERESTED', 'high')).toEqual({ text: 'Interested', tone: 'success' });
    expect(labelFor('NOT_INTERESTED', 'medium')).toEqual({ text: 'Not interested', tone: 'destructive' });
  });
  it('treats NEUTRAL and low confidence as Unsure', () => {
    expect(labelFor('NEUTRAL', 'high')).toEqual({ text: 'Unsure', tone: 'warning' });
    expect(labelFor('INTERESTED', 'low')).toEqual({ text: 'Unsure', tone: 'warning' });
  });
});

describe('VIEWS', () => {
  it('lists the five views in rail order with an inbox-zero empty state', () => {
    expect(VIEWS.map((v) => v.label)).toEqual(['Needs review', 'Interested', 'Not interested', 'Snoozed', 'Sent today']);
    expect(VIEWS[0].empty).toBe('Inbox zero — nothing waiting');
  });
});

describe('snoozePresets', () => {
  // Thursday 2026-10-22 11:00 EDT
  const now = new Date('2026-10-22T15:00:00Z');
  const byKey = Object.fromEntries(snoozePresets(now).map((p) => [p.key, p]));

  it('later today is +3h', () => {
    expect(byKey.later.until.toISOString()).toBe('2026-10-22T18:00:00.000Z');
  });
  it('later today never crosses ET midnight', () => {
    const late = Object.fromEntries(snoozePresets(new Date('2026-10-23T02:30:00Z')).map((p) => [p.key, p]));
    expect(late.later.until.toISOString()).toBe('2026-10-23T03:59:00.000Z');
  });
  it('tomorrow is 9am ET', () => {
    expect(byKey.tomorrow.until.toISOString()).toBe('2026-10-23T13:00:00.000Z');
    expect(byKey.tomorrow.label).toBe('Tomorrow 9am ET');
  });
  it('next week is next Monday 9am ET', () => {
    expect(byKey.next_week.until.toISOString()).toBe('2026-10-26T13:00:00.000Z');
  });
  it('custom date is 9am ET that day, across DST', () => {
    expect(customSnooze('2026-11-10').toISOString()).toBe('2026-11-10T14:00:00.000Z');
  });
});

describe('formatAge', () => {
  it('formats compact ages', () => {
    expect(formatAge(20_000)).toBe('now');
    expect(formatAge(5 * 60_000)).toBe('5m');
    expect(formatAge(3 * 3600_000)).toBe('3h');
    expect(formatAge(50 * 3600_000)).toBe('2d');
  });
});

describe('highlightSegments', () => {
  it('marks the evidence quote', () => {
    expect(highlightSegments('a b c', 'b')).toEqual([
      { text: 'a ', mark: false },
      { text: 'b', mark: true },
      { text: ' c', mark: false },
    ]);
  });
  it('returns the text unmarked when the quote is missing or absent', () => {
    expect(highlightSegments('a b c', null)).toEqual([{ text: 'a b c', mark: false }]);
    expect(highlightSegments('a b c', 'zzz')).toEqual([{ text: 'a b c', mark: false }]);
  });
});

describe('diffWords', () => {
  it('reports removed and added words', () => {
    const d = diffWords('hi there', 'hi you');
    expect(d).toContainEqual({ text: 'there', op: 'del' });
    expect(d).toContainEqual({ text: 'you', op: 'add' });
    expect(d[0]).toEqual({ text: 'hi ', op: 'same' });
  });
  it('is all same for identical text', () => {
    expect(diffWords('a b', 'a b')).toEqual([{ text: 'a b', op: 'same' }]);
  });
});

describe('sendLine', () => {
  it('spells out mailbox and CC', () => {
    expect(sendLine('rae@x.com', null)).toBe('Sending as rae@x.com · CC no one');
    expect(sendLine('rae@x.com', 'Sofia')).toBe('Sending as rae@x.com · CC Sofia');
  });
});

describe('nextItemId', () => {
  it('advances, falls back to previous, then null', () => {
    expect(nextItemId(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextItemId(['a', 'b', 'c'], 'c')).toBe('b');
    expect(nextItemId(['a'], 'a')).toBeNull();
    expect(nextItemId(['a', 'b'], 'zz')).toBe('a');
  });
});

describe('messagePlainText', () => {
  it('prefers the text body and falls back to stripped HTML', async () => {
    const { messagePlainText } = await import('../../src/lib/inbox');
    expect(messagePlainText('hello', '<p>x</p>')).toBe('hello');
    expect(messagePlainText(null, '<p>Hi&nbsp;there</p><p>Bye &amp; thanks</p>')).toBe('Hi there\nBye & thanks');
    expect(messagePlainText(null, null)).toBe('');
  });
});

describe('triage draft helpers (H8)', () => {
  it('maps a triage decision to the view the draft lands in', () => {
    expect(viewForClass('INTERESTED')).toBe('interested');
    expect(viewForClass('NOT_INTERESTED')).toBe('not_interested');
  });

  it('describes a hand-off draft by CC first name and mailbox local part', () => {
    expect(draftedLine({ classification: 'INTERESTED', mailbox: 'paul.b@archive.com', ccEmail: 'sofia@archive.com', ccFirstName: 'Sofia' })).toBe(
      'Hand-off to Sofia from paul.b@'
    );
    // No CC options loaded yet: fall back to the CC's local part.
    expect(draftedLine({ classification: 'INTERESTED', mailbox: 'paul.b@archive.com', ccEmail: 'Sofia@archive.com' })).toBe(
      'Hand-off to Sofia from paul.b@'
    );
  });

  it('describes anything else as a reply from the mailbox', () => {
    expect(draftedLine({ classification: 'INTERESTED', mailbox: 'sofia@archive.com', ccEmail: '' })).toBe('Reply from sofia@archive.com');
    expect(draftedLine({ classification: 'INTERESTED', mailbox: 'sofia@archive.com', ccEmail: 'SOFIA@archive.com' })).toBe('Reply from sofia@archive.com');
    expect(draftedLine({ classification: 'NOT_INTERESTED', mailbox: 'paul.b@archive.com', ccEmail: 'sofia@archive.com' })).toBe(
      'Reply from paul.b@archive.com'
    );
  });
});
