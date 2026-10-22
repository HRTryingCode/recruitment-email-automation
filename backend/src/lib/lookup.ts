// Pure helpers behind GET /api/lookup (F1 "do we know this person?").
// The route does the bounded DB reads; everything that decides what the
// answer says lives here so it can be tested without Prisma.

export type LookupVerdict =
  | 'CANDIDATE'
  | 'CONTACTED_NO_REPLY'
  | 'REPLIED_NOT_CANDIDATE'
  | 'UNKNOWN';

/**
 * Why an inbound message from this address never became a candidate:
 *   NOT_RECRUITING — SystemLog MESSAGE_SKIPPED_NOT_RECRUITING
 *   NO_ROLE        — SystemLog MESSAGE_SKIPPED_NO_ROLE
 *   FILTERED       — stored with processingState SKIPPED (internal sender,
 *                    automated/no-reply mail, or too old to classify)
 */
export type SkipReason = 'NOT_RECRUITING' | 'NO_ROLE' | 'FILTERED';

const SKIP_REASON_PRIORITY: SkipReason[] = ['NOT_RECRUITING', 'NO_ROLE', 'FILTERED'];

const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  NOT_RECRUITING: 'skipped as not recruiting-related',
  NO_ROLE: 'skipped (no role detected)',
  FILTERED: 'skipped as internal or automated mail',
};

const MAX_EMAIL_LENGTH = 254;
// Deliberately simple: one @, no whitespace, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lowercased email, or null when `raw` is not a single plausible address. */
export function normalizeLookupEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * True when the JSON-encoded EmailMessage.toAddresses contains `email` as a
 * whole address. Entries may be raw header fragments (`"Doe, Jane" <j@x>`,
 * or several comma-joined), so each fragment's angle-bracket address wins.
 */
export function addressListContains(toAddressesJson: string, email: string): boolean {
  let entries: unknown;
  try {
    entries = JSON.parse(toAddressesJson);
  } catch {
    return false;
  }
  if (!Array.isArray(entries)) return false;
  return entries
    .filter((e): e is string => typeof e === 'string')
    .flatMap((entry) => entry.split(','))
    .some((frag) => {
      const angle = frag.match(/<([^>]+)>/);
      return (angle ? angle[1] : frag).trim().toLowerCase() === email;
    });
}

export interface LookupMessageRow {
  threadId: string;
  mailboxId: string;
  externalMessageId: string;
  fromAddress: string;
  toAddresses: string;
  subject: string;
  receivedAt: Date;
  processingState: string;
}

export interface MessageSummary {
  inbound: number;
  outbound: number;
  firstAt: Date | null;
  lastAt: Date | null;
  mailboxIds: string[];
  threadIds: string[];
  latestSubject: string | null;
  /** Inbound rows stored without classification (processingState SKIPPED). */
  inboundSkippedByFilter: number;
  /** Gmail ids of inbound rows, newest first — SystemLog skip events key on these. */
  inboundExternalIds: string[];
  lastInbound: {
    externalMessageId: string;
    receivedAt: Date;
    mailboxId?: string;
    mailboxEmail?: string | null;
  } | null;
  lastOutbound: {
    fromAddress: string;
    receivedAt: Date;
    mailboxId?: string;
  } | null;
}

/**
 * Summarize messages to/from `email`. Rows come from a substring prefilter
 * in SQL, so rows where the address only appears inside a longer address
 * (bob@ vs jimbob@) are dropped here.
 */
export function summarizeMessages(rows: LookupMessageRow[], email: string): MessageSummary {
  const out: MessageSummary = {
    inbound: 0,
    outbound: 0,
    firstAt: null,
    lastAt: null,
    mailboxIds: [],
    threadIds: [],
    latestSubject: null,
    inboundSkippedByFilter: 0,
    inboundExternalIds: [],
    lastInbound: null,
    lastOutbound: null,
  };
  const mailboxes = new Set<string>();
  const threads = new Set<string>();
  const sorted = [...rows].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());

  for (const m of sorted) {
    const isInbound = m.fromAddress.trim().toLowerCase() === email;
    const isOutbound = !isInbound && addressListContains(m.toAddresses, email);
    if (!isInbound && !isOutbound) continue;

    mailboxes.add(m.mailboxId);
    threads.add(m.threadId);
    if (!out.lastAt) {
      out.lastAt = m.receivedAt;
      out.latestSubject = m.subject;
    }
    out.firstAt = m.receivedAt;

    if (isInbound) {
      out.inbound += 1;
      out.inboundExternalIds.push(m.externalMessageId);
      if (m.processingState === 'SKIPPED') out.inboundSkippedByFilter += 1;
      if (!out.lastInbound) {
        out.lastInbound = {
          externalMessageId: m.externalMessageId,
          receivedAt: m.receivedAt,
          mailboxId: m.mailboxId,
        };
      }
    } else {
      out.outbound += 1;
      if (!out.lastOutbound) {
        out.lastOutbound = { fromAddress: m.fromAddress, receivedAt: m.receivedAt, mailboxId: m.mailboxId };
      }
    }
  }
  out.mailboxIds = [...mailboxes];
  out.threadIds = [...threads];
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct" in the current year, "3 Oct 2025" otherwise (UTC). */
export function formatShortDate(d: Date, now: Date): string {
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** "paul.b@archive.com" → "paul.b@" — the way recruiters refer to inboxes. */
function shortMailbox(address: string): string {
  const at = address.indexOf('@');
  return at > 0 ? address.slice(0, at + 1) : address;
}

function humanStatus(status: string): string {
  const s = status.replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface VerdictInput {
  candidate: {
    name: string;
    status: string;
    role: string | null;
    mailboxEmail: string | null;
  } | null;
  messages: MessageSummary;
  skipped: SkipReason[];
  now: Date;
}

export function computeVerdict(input: VerdictInput): { verdict: LookupVerdict; summary: string } {
  const { candidate, messages, skipped, now } = input;

  if (candidate) {
    let summary = `Candidate (${humanStatus(candidate.status)})`;
    if (candidate.role) summary += ` for ${candidate.role}`;
    if (candidate.mailboxEmail) summary += ` — via ${shortMailbox(candidate.mailboxEmail)}`;
    if (messages.lastAt) summary += ` · last activity ${formatShortDate(messages.lastAt, now)}`;
    return { verdict: 'CANDIDATE', summary };
  }

  if (messages.inbound > 0 && messages.lastInbound) {
    const to = messages.lastInbound.mailboxEmail
      ? shortMailbox(messages.lastInbound.mailboxEmail)
      : 'us';
    const reason = SKIP_REASON_PRIORITY.find((r) => skipped.includes(r));
    const tail = reason ? SKIP_REASON_TEXT[reason] : 'not classified as a candidate';
    return {
      verdict: 'REPLIED_NOT_CANDIDATE',
      summary: `They wrote to ${to} on ${formatShortDate(messages.lastInbound.receivedAt, now)} — ${tail}`,
    };
  }

  if (messages.outbound > 0 && messages.lastOutbound) {
    return {
      verdict: 'CONTACTED_NO_REPLY',
      summary: `We emailed them from ${shortMailbox(messages.lastOutbound.fromAddress)} on ${formatShortDate(messages.lastOutbound.receivedAt, now)} — no reply yet`,
    };
  }

  return { verdict: 'UNKNOWN', summary: 'No trace of this email in any connected mailbox' };
}
