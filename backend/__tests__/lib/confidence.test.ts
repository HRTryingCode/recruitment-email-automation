import { describe, it, expect } from 'vitest';
import { confidenceLabel } from '../../src/lib/confidence';
import { DECLINE_OVERRIDE_CONFIDENCE, LOW_CONFIDENCE_THRESHOLD } from '../../src/lib/candidateState';

describe('confidenceLabel (U0)', () => {
  it('uses the existing thresholds: 0.7 drafting floor, 0.85 decline override', () => {
    expect(LOW_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(DECLINE_OVERRIDE_CONFIDENCE).toBe(0.85);
  });

  it.each([
    [1, 'high'],
    [0.85, 'high'],
    [0.84, 'medium'],
    [0.7, 'medium'],
    [0.69, 'low'],
    [0, 'low'],
  ])('%s → %s', (c, label) => {
    expect(confidenceLabel(c)).toBe(label);
  });
});
