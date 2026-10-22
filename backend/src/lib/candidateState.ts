/**
 * Candidate state rules, kept pure so the transition table is unit-testable.
 *
 * Two independent things live on a Candidate (H6):
 *  - `status`: the candidate's *interest* classification
 *    (INTERESTED / NEUTRAL / NOT_INTERESTED, plus the NEEDS_REVIEW and
 *    PENDING placeholders and the recruiter-only IGNORED).
 *  - conversation state: whose turn it is, from `lastInboundAt` (candidate's
 *    latest message) vs `lastOutboundAt` (the recruiter's latest message).
 *
 * `REPLIED` used to be written into `status` on send, which erased the
 * classification and never came back down. It is now only a legacy value:
 * any later classification replaces it.
 */

/** Below this, ingestion routes to NEEDS_REVIEW instead of auto-drafting. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** A decline at or above this confidence overrides INTERESTED / NEUTRAL. */
export const DECLINE_OVERRIDE_CONFIDENCE = 0.85;

/** NOT_RECRUITING_RELATED must be at least this confident to drop a message. */
export const NOT_RECRUITING_SKIP_CONFIDENCE = 0.9;

// Interest ranking used for the no-downgrade rule. Placeholders are absent:
// they are replaced by any real classification.
const INTEREST_RANK: Record<string, number> = {
  NOT_INTERESTED: 1,
  NEUTRAL: 2,
  INTERESTED: 3,
};

// States that carry no interest signal and give way to the next classification.
const PLACEHOLDER_STATUSES = new Set(['PENDING', 'NEEDS_REVIEW', 'REPLIED']);

/**
 * The status to store after classifying a new inbound message.
 *
 * @param current   existing Candidate.status, or null for a new candidate
 * @param desired   what this message says: a classification, or NEEDS_REVIEW
 *                  when the classifier flagged it / was under-confident
 * @param confidence classifier confidence for this message
 */
export function resolveCandidateStatus(
  current: string | null,
  desired: string,
  confidence: number
): string {
  if (current === null) return desired;
  if (current === 'IGNORED') return current;

  if (desired === 'NEEDS_REVIEW') {
    // An ambiguous follow-up shouldn't erase a confident interest state:
    // conversation state already surfaces it as "awaiting reply".
    return current === 'INTERESTED' || current === 'NOT_INTERESTED' ? current : 'NEEDS_REVIEW';
  }

  if (PLACEHOLDER_STATUSES.has(current) || !(current in INTEREST_RANK)) return desired;

  if (desired === 'NOT_INTERESTED' && confidence >= DECLINE_OVERRIDE_CONFIDENCE) return desired;

  // Otherwise never downgrade (e.g. a NEUTRAL logistics reply from an
  // INTERESTED candidate), but allow upgrades.
  return (INTEREST_RANK[desired] ?? 0) > (INTEREST_RANK[current] ?? 0) ? desired : current;
}

export type ReplyStatus = 'NEW' | 'AWAITING_REPLY' | 'REPLIED';

/**
 * Whose turn it is. AWAITING_REPLY means the candidate wrote and the
 * recruiter hasn't answered since (lastInboundAt > lastOutboundAt).
 *
 * Rows the lastInbound/lastOutbound backfill hasn't reached (lastInboundAt
 * null) keep the legacy repliedAt rule so nothing regresses before it runs.
 */
export function deriveReplyStatus(c: {
  lastInboundAt?: Date | null;
  lastOutboundAt?: Date | null;
  repliedAt: Date | null;
  threads: unknown[];
}): ReplyStatus {
  if (c.lastInboundAt) {
    return c.lastOutboundAt && c.lastOutboundAt.getTime() >= c.lastInboundAt.getTime()
      ? 'REPLIED'
      : 'AWAITING_REPLY';
  }
  if (c.repliedAt) return 'REPLIED';
  if (!c.threads.length) return 'NEW';
  return 'AWAITING_REPLY';
}

/**
 * Whether a NOT_RECRUITING_RELATED classification may drop the message (M15).
 * Never on a thread the mailbox itself wrote on (outreach), one already
 * linked to a candidate, or mail from a known candidate — those go to
 * NEEDS_REVIEW instead so a human sees them.
 */
export function shouldSkipNotRecruiting(opts: {
  confidence: number;
  threadHasOutboundFromMailbox: boolean;
  threadLinkedToCandidate: boolean;
  knownCandidate: boolean;
}): boolean {
  if (opts.threadHasOutboundFromMailbox || opts.threadLinkedToCandidate || opts.knownCandidate) {
    return false;
  }
  return opts.confidence >= NOT_RECRUITING_SKIP_CONFIDENCE;
}

/** Canonical form for email addresses we store and match on (M12). */
export { normalizeEmail } from './senderIdentity';
