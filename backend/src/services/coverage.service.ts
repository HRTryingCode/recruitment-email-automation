/**
 * Sender coverage (audit H2, M32 phase 1).
 *
 * Gem sequences are sent from executive send-aliases (ethan@, p.benigeri@,
 * ...). If no connected mailbox receives replies to an alias, those replies
 * are invisible and nothing warns anyone. This service diffs the senders we
 * EXPECT recruiting mail from against what we actually monitor:
 *
 *   monitored = every active Mailbox.emailAddress + its stored sendAs aliases
 *
 * and reports:
 *   - unmonitored:    expected senders no connected mailbox/alias covers
 *   - quietMailboxes: connected mailboxes with 0 outbound in 30 days while
 *                     sends are expected from one of their addresses
 *
 * Expected senders come from ExpectedSenderSource implementations. Today the
 * only one reads the admin-maintained ExpectedSender table (/api/coverage).
 * Gem seam: there is no Gem API credential on the server yet. When there is,
 * either
 *   (a) add a source here whose listExpectedSenders() calls Gem's sent-as
 *       identities + 30-day send counts (live, nothing stored), or
 *   (b) run a sync job that upserts ExpectedSender rows with source = "GEM",
 *       externalId = Gem user id and expectedSends30d, which the DB source
 *       below already picks up.
 * computeCoverage merges sources by normalized address, so both can coexist.
 */
import { prisma } from '../db/client';
import { config } from '../config';
import { normalizeEmail, mailboxOwnAddresses } from '../lib/senderIdentity';
import { sendAlert, type Alert, type AlertResult } from './alert.service';
import { logEvent } from './monitoring.service';

export const COVERAGE_WINDOW_DAYS = 30;

export interface ExpectedSenderRecord {
  emailAddress: string;
  displayName: string | null;
  /** "ADMIN" | "GEM" | ... */
  source: string;
  /** Upstream sends in the last 30 days; null = unknown. */
  expectedSends30d: number | null;
}

export interface ExpectedSenderSource {
  readonly name: string;
  listExpectedSenders(): Promise<ExpectedSenderRecord[]>;
}

/** Active rows of the ExpectedSender table (admin-entered or synced). */
export const dbExpectedSenderSource: ExpectedSenderSource = {
  name: 'DB',
  async listExpectedSenders() {
    return prisma.expectedSender.findMany({
      where: { isActive: true },
      select: { emailAddress: true, displayName: true, source: true, expectedSends30d: true },
    });
  },
};

export function defaultExpectedSenderSources(): ExpectedSenderSource[] {
  return [dbExpectedSenderSource];
}

export interface UnmonitoredSender {
  emailAddress: string;
  displayName: string | null;
  sources: string[];
  expectedSends30d: number | null;
}

export interface QuietMailbox {
  mailboxId: string;
  emailAddress: string;
  outbound30d: number;
  expectedAddresses: string[];
  expectedSends30d: number | null;
}

export interface CoverageMailbox {
  id: string;
  emailAddress: string;
  displayName: string | null;
  sendAsAddresses: string[];
  sendAsSyncedAt: Date | null;
  authStatus: string;
  outbound30d: number;
}

export interface CoverageReport {
  generatedAt: Date;
  windowDays: number;
  expectedSenderCount: number;
  unmonitored: UnmonitoredSender[];
  quietMailboxes: QuietMailbox[];
  mailboxes: CoverageMailbox[];
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

function sumNullable(values: Array<number | null>): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length === 0 ? null : known.reduce((s, v) => s + v, 0);
}

async function loadExpectedSenders(sources: ExpectedSenderSource[]): Promise<UnmonitoredSender[]> {
  const merged = new Map<string, UnmonitoredSender>();
  for (const source of sources) {
    for (const rec of await source.listExpectedSenders()) {
      const email = normalizeEmail(rec.emailAddress);
      if (!email) continue;
      const prev = merged.get(email);
      if (!prev) {
        merged.set(email, {
          emailAddress: email,
          displayName: rec.displayName,
          sources: [rec.source],
          expectedSends30d: rec.expectedSends30d,
        });
        continue;
      }
      if (!prev.sources.includes(rec.source)) prev.sources.push(rec.source);
      prev.displayName = prev.displayName ?? rec.displayName;
      prev.expectedSends30d = maxNullable(prev.expectedSends30d, rec.expectedSends30d);
    }
  }
  return [...merged.values()];
}

export async function computeCoverage(
  opts: { now?: Date; sources?: ExpectedSenderSource[] } = {}
): Promise<CoverageReport> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - COVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [expected, mailboxes, outboundRows] = await Promise.all([
    loadExpectedSenders(opts.sources ?? defaultExpectedSenderSources()),
    prisma.mailbox.findMany({
      where: { isActive: true },
      select: {
        id: true,
        emailAddress: true,
        displayName: true,
        sendAsAddresses: true,
        sendAsSyncedAt: true,
        authStatus: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    // One grouped query: internal-domain senders per mailbox in the window.
    // Per-mailbox "own address" filtering happens below.
    prisma.emailMessage.groupBy({
      by: ['mailboxId', 'fromAddress'],
      where: {
        receivedAt: { gte: since },
        OR: config.internalDomains.map((d) => ({
          fromAddress: { endsWith: `@${d}`, mode: 'insensitive' as const },
        })),
      },
      _count: { _all: true },
    }),
  ]);

  const owner = new Map<string, string>(); // address -> mailboxId
  const coverageMailboxes: CoverageMailbox[] = mailboxes.map((m) => {
    const own = mailboxOwnAddresses(m);
    for (const a of own) if (!owner.has(a)) owner.set(a, m.id);
    const outbound30d = outboundRows
      .filter((r) => r.mailboxId === m.id && own.includes(normalizeEmail(r.fromAddress)))
      .reduce((s, r) => s + r._count._all, 0);
    return {
      id: m.id,
      emailAddress: m.emailAddress,
      displayName: m.displayName,
      sendAsAddresses: m.sendAsAddresses ?? [],
      sendAsSyncedAt: m.sendAsSyncedAt,
      authStatus: m.authStatus,
      outbound30d,
    };
  });

  const unmonitored = expected
    .filter((e) => !owner.has(e.emailAddress))
    .sort((a, b) => (b.expectedSends30d ?? -1) - (a.expectedSends30d ?? -1));

  const quietMailboxes: QuietMailbox[] = [];
  for (const m of coverageMailboxes) {
    if (m.outbound30d > 0) continue;
    // Expected senders this mailbox covers that still expect sends
    // (unknown volume counts as "expected"; an explicit 0 does not).
    const mine = expected.filter(
      (e) => owner.get(e.emailAddress) === m.id && e.expectedSends30d !== 0
    );
    if (mine.length === 0) continue;
    quietMailboxes.push({
      mailboxId: m.id,
      emailAddress: m.emailAddress,
      outbound30d: 0,
      expectedAddresses: mine.map((e) => e.emailAddress),
      expectedSends30d: sumNullable(mine.map((e) => e.expectedSends30d)),
    });
  }

  return {
    generatedAt: now,
    windowDays: COVERAGE_WINDOW_DAYS,
    expectedSenderCount: expected.length,
    unmonitored,
    quietMailboxes,
    mailboxes: coverageMailboxes,
  };
}

function sendsLabel(n: number | null): string {
  return n === null ? 'volume unknown' : `~${n} sends/30d`;
}

/**
 * Slack text. Contains internal sender addresses only — never candidate
 * addresses or message content.
 */
export function formatCoverageAlert(report: CoverageReport): Alert {
  const gaps = report.unmonitored.length + report.quietMailboxes.length;
  if (gaps === 0) {
    return {
      severity: 'resolved',
      title: 'Weekly sender coverage: all expected senders monitored',
      text: `${report.expectedSenderCount} expected sender(s), ${report.mailboxes.length} connected mailbox(es). No gaps.`,
    };
  }
  const lines: string[] = [];
  if (report.unmonitored.length > 0) {
    lines.push(`*Unmonitored senders* (replies to these are invisible to the app):`);
    for (const u of report.unmonitored) {
      lines.push(`• ${u.emailAddress} (${sendsLabel(u.expectedSends30d)})`);
    }
  }
  if (report.quietMailboxes.length > 0) {
    lines.push(`*Connected but 0 outbound in ${report.windowDays}d* while sends are expected:`);
    for (const q of report.quietMailboxes) {
      lines.push(
        `• ${q.emailAddress} — expected from ${q.expectedAddresses.join(', ')} (${sendsLabel(q.expectedSends30d)})`
      );
    }
  }
  lines.push('Fix: connect the mailbox, add the alias as a Gmail send-as on a connected mailbox, or route replies. See Dashboard → Sender coverage.');
  return {
    severity: 'warning',
    title: `Weekly sender coverage: ${gaps} gap(s)`,
    text: lines.join('\n'),
  };
}

export async function sendWeeklyCoverageSummary(
  opts: { now?: Date; sources?: ExpectedSenderSource[] } = {}
): Promise<{ sent: boolean; reason?: AlertResult['reason']; unmonitored: number; quietMailboxes: number }> {
  const report = await computeCoverage(opts);
  const result = await sendAlert(formatCoverageAlert(report));
  // Counts only — addresses stay out of SystemLog.
  await logEvent(
    'SENDER_COVERAGE_SUMMARY',
    {
      unmonitored: report.unmonitored.length,
      quietMailboxes: report.quietMailboxes.length,
      expectedSenders: report.expectedSenderCount,
      mailboxes: report.mailboxes.length,
      alertSent: result.sent,
    },
    report.unmonitored.length + report.quietMailboxes.length > 0 ? 'WARN' : 'INFO'
  );
  return {
    sent: result.sent,
    ...(result.reason ? { reason: result.reason } : {}),
    unmonitored: report.unmonitored.length,
    quietMailboxes: report.quietMailboxes.length,
  };
}
