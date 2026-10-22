import { describe, expect, it } from 'vitest';
import { formatAge, initials } from '../../src/lib/utils';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatAge — one compact age for lists, tiles and Lever checks', () => {
  it.each([
    [20_000, 'now'],
    [5 * MIN, '5m'],
    [3 * HOUR, '3h'],
    [50 * HOUR, '2d'],
  ])('%d ms → %s', (ms, label) => {
    expect(formatAge(ms)).toBe(label);
  });

  it.each([
    [10_000, '< 1m'],
    [45 * MIN, '45m'],
    [5 * HOUR, '5h'],
    [2 * DAY + 4 * HOUR, '2d 4h'],
    [3 * DAY, '3d'],
  ])('withHours: %d ms → %s', (ms, label) => {
    expect(formatAge(ms, { withHours: true })).toBe(label);
  });
});

describe('initials', () => {
  it('takes up to two initials from the name, else the email, else "?"', () => {
    expect(initials('Sofia Delgado')).toBe('SD');
    expect(initials('Ada Lovelace King')).toBe('AL');
    expect(initials(undefined, 'paul@archive.com')).toBe('P');
    expect(initials('  ')).toBe('?');
    expect(initials()).toBe('?');
  });
});
