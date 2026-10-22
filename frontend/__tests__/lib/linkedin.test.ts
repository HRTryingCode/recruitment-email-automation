import { describe, it, expect } from 'vitest';
import { normalizeLinkedinUrl } from '@/lib/linkedin';
// The backend owns the rule and its vectors; this mirror must agree with them.
import { LINKEDIN_URL_CASES } from '../../../backend/src/lib/linkedin.cases';

describe('normalizeLinkedinUrl (frontend mirror)', () => {
  it.each(LINKEDIN_URL_CASES)('%s → %s', (input, expected) => {
    expect(normalizeLinkedinUrl(input)).toBe(expected);
  });
});
