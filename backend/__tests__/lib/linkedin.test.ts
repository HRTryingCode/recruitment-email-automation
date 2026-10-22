import { describe, it, expect } from 'vitest';
import { normalizeLinkedinUrl } from '../../src/lib/linkedin';
import { LINKEDIN_URL_CASES } from '../../src/lib/linkedin.cases';

describe('normalizeLinkedinUrl', () => {
  it.each(LINKEDIN_URL_CASES)('%s → %s', (input, expected) => {
    expect(normalizeLinkedinUrl(input)).toBe(expected);
  });

  it('non-strings and blanks are null', () => {
    for (const v of [undefined, null, 42, {}, '', '   ']) expect(normalizeLinkedinUrl(v)).toBeNull();
  });
});
