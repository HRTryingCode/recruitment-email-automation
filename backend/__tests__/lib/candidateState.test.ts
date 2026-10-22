import { describe, it, expect } from 'vitest';
import {
  resolveCandidateStatus,
  deriveReplyStatus,
  shouldSkipNotRecruiting,
  normalizeEmail,
  DECLINE_OVERRIDE_CONFIDENCE,
  NOT_RECRUITING_SKIP_CONFIDENCE,
} from '../../src/lib/candidateState';

// H6: status transition table. Each row: current status, the status the
// classifier asks for, its confidence, expected result.
describe('resolveCandidateStatus (H6)', () => {
  const rows: Array<[string | null, string, number, string, string]> = [
    // New candidate: whatever the classifier says.
    [null, 'INTERESTED', 0.9, 'INTERESTED', 'new candidate takes the classification'],
    [null, 'NEEDS_REVIEW', 0.4, 'NEEDS_REVIEW', 'new candidate can start in review'],
    // No downgrade from a logistics follow-up.
    ['INTERESTED', 'NEUTRAL', 0.95, 'INTERESTED', 'NEUTRAL follow-up does not downgrade INTERESTED'],
    ['NEUTRAL', 'INTERESTED', 0.9, 'INTERESTED', 'upgrade NEUTRAL -> INTERESTED'],
    ['NOT_INTERESTED', 'INTERESTED', 0.9, 'INTERESTED', 'candidate changed their mind'],
    // A confident decline overrides interest.
    ['INTERESTED', 'NOT_INTERESTED', 0.97, 'NOT_INTERESTED', 'confident decline overrides INTERESTED'],
    ['NEUTRAL', 'NOT_INTERESTED', 0.99, 'NOT_INTERESTED', 'confident decline overrides NEUTRAL'],
    ['INTERESTED', 'NOT_INTERESTED', 0.8, 'INTERESTED', 'a soft decline does not override INTERESTED'],
    // NEEDS_REVIEW is a placeholder, cleared by any confident classification.
    ['NEEDS_REVIEW', 'NEUTRAL', 0.9, 'NEUTRAL', 'NEEDS_REVIEW cleared by later confident NEUTRAL'],
    ['NEEDS_REVIEW', 'NOT_INTERESTED', 0.75, 'NOT_INTERESTED', 'NEEDS_REVIEW cleared by later confident decline'],
    ['NEEDS_REVIEW', 'NEEDS_REVIEW', 0.3, 'NEEDS_REVIEW', 'still ambiguous stays in review'],
    // An ambiguous message flags PENDING/NEUTRAL but does not wipe a confident state.
    ['PENDING', 'NEEDS_REVIEW', 0.5, 'NEEDS_REVIEW', 'PENDING -> NEEDS_REVIEW'],
    ['NEUTRAL', 'NEEDS_REVIEW', 0.5, 'NEEDS_REVIEW', 'NEUTRAL -> NEEDS_REVIEW'],
    ['INTERESTED', 'NEEDS_REVIEW', 0.5, 'INTERESTED', 'ambiguous follow-up keeps INTERESTED'],
    ['NOT_INTERESTED', 'NEEDS_REVIEW', 0.5, 'NOT_INTERESTED', 'ambiguous follow-up keeps NOT_INTERESTED'],
    // Legacy REPLIED (written by the old send path) is not an interest state.
    ['REPLIED', 'NEUTRAL', 0.9, 'NEUTRAL', 'legacy REPLIED replaced by a classification'],
    ['REPLIED', 'NOT_INTERESTED', 0.9, 'NOT_INTERESTED', 'legacy REPLIED replaced by a decline'],
    ['REPLIED', 'NEEDS_REVIEW', 0.4, 'NEEDS_REVIEW', 'legacy REPLIED replaced by review'],
    // IGNORED is a recruiter decision and never changes from classification.
    ['IGNORED', 'INTERESTED', 0.99, 'IGNORED', 'IGNORED is sticky'],
  ];

  for (const [current, desired, confidence, expected, label] of rows) {
    it(label, () => {
      expect(resolveCandidateStatus(current, desired, confidence)).toBe(expected);
    });
  }

  it('decline threshold is 0.85', () => {
    expect(DECLINE_OVERRIDE_CONFIDENCE).toBe(0.85);
    expect(resolveCandidateStatus('INTERESTED', 'NOT_INTERESTED', 0.85)).toBe('NOT_INTERESTED');
  });
});

describe('deriveReplyStatus (H6)', () => {
  const t = (iso: string) => new Date(iso);

  it('AWAITING_REPLY when the candidate wrote after our last outbound', () => {
    expect(
      deriveReplyStatus({
        lastInboundAt: t('2026-10-10T10:00:00Z'),
        lastOutboundAt: t('2026-10-09T10:00:00Z'),
        repliedAt: t('2026-10-09T10:00:00Z'),
        threads: [{}],
      })
    ).toBe('AWAITING_REPLY');
  });

  it('REPLIED when our outbound is the latest message', () => {
    expect(
      deriveReplyStatus({
        lastInboundAt: t('2026-10-09T10:00:00Z'),
        lastOutboundAt: t('2026-10-10T10:00:00Z'),
        repliedAt: null,
        threads: [{}],
      })
    ).toBe('REPLIED');
  });

  it('AWAITING_REPLY when the candidate wrote and we never did', () => {
    expect(
      deriveReplyStatus({ lastInboundAt: t('2026-10-09T10:00:00Z'), lastOutboundAt: null, repliedAt: null, threads: [{}] })
    ).toBe('AWAITING_REPLY');
  });

  it('falls back to the legacy repliedAt rule for rows the backfill has not reached', () => {
    expect(deriveReplyStatus({ lastInboundAt: null, lastOutboundAt: null, repliedAt: t('2026-10-01T00:00:00Z'), threads: [{}] })).toBe('REPLIED');
    expect(deriveReplyStatus({ lastInboundAt: null, lastOutboundAt: null, repliedAt: null, threads: [{}] })).toBe('AWAITING_REPLY');
    expect(deriveReplyStatus({ lastInboundAt: null, lastOutboundAt: null, repliedAt: null, threads: [] })).toBe('NEW');
  });
});

describe('shouldSkipNotRecruiting (M15)', () => {
  const base = { confidence: 0.95, threadHasOutboundFromMailbox: false, threadLinkedToCandidate: false, knownCandidate: false };

  it('skips a confident, unrelated, inbound-only thread', () => {
    expect(shouldSkipNotRecruiting(base)).toBe(true);
  });
  it('requires >= 0.9 confidence', () => {
    expect(NOT_RECRUITING_SKIP_CONFIDENCE).toBe(0.9);
    expect(shouldSkipNotRecruiting({ ...base, confidence: 0.89 })).toBe(false);
    expect(shouldSkipNotRecruiting({ ...base, confidence: 0.9 })).toBe(true);
  });
  it('never skips a thread the mailbox wrote on (outreach)', () => {
    expect(shouldSkipNotRecruiting({ ...base, confidence: 1, threadHasOutboundFromMailbox: true })).toBe(false);
  });
  it('never skips a thread already linked to a candidate', () => {
    expect(shouldSkipNotRecruiting({ ...base, confidence: 1, threadLinkedToCandidate: true })).toBe(false);
  });
  it('never skips mail from a known candidate', () => {
    expect(shouldSkipNotRecruiting({ ...base, confidence: 1, knownCandidate: true })).toBe(false);
  });
});

describe('normalizeEmail (M12)', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
});
