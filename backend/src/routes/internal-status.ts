import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { logEvent } from '../services/monitoring.service';
import { safeError } from '../lib/safeError';

const router = Router();

interface MailboxSyncHealth {
  mailboxId: string;
  emailAddress: string;
  displayName: string | null;
  isActive: boolean;
  /** "OK" | "NEEDS_REAUTH" — see Mailbox.authStatus. */
  authStatus: string;
  lastAuthError: string | null;
  lastAuthErrorAt: string | null;
  watchExpiry: string | null;
  watchExpiresInHours: number | null;
  lastSyncedMessageAt: string | null;
  lastReconciliationAt: string | null;
  lastReconciliationFoundMissing: number;
  /** Error of the latest RECONCILIATION_FAILED, if it is newer than the last success. */
  lastReconcileError: string | null;
  /** RECONCILIATION_FAILED rows since the last successful run (48h window). */
  consecutiveReconcileFailures: number;
  // Count fields are null when `error` is true (stats query failed) so the
  // UI never mistakes "unknown" for "zero".
  messagesLast24h: number | null;
  totalMessages: number | null;
  totalCandidates: number | null;
  pendingDrafts: number | null;
  candidatesNeedsReview: number | null;
  webhookErrorsLast24h: number;
  lastWebhookError: string | null;
  /** True when part of this row could not be computed. */
  error: boolean;
}

interface MailboxStatsRow {
  mailboxId: string;
  lastSyncedMessageAt: Date | null;
  messagesLast24h: bigint | number;
  totalMessages: bigint | number;
  totalCandidates: bigint | number;
  pendingDrafts: bigint | number;
  candidatesNeedsReview: bigint | number;
}

/**
 * Best-effort parse of a SystemLog.details JSON blob into a record.
 * Returns an empty object on any error so callers can do `details.missingBefore`
 * without exploding on malformed rows.
 */
function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// GET /api/internal/sync-health
// Auth-gated by the user JWT (mounted with requireAuth in app.ts). Returns
// per-mailbox sync health for the dashboard / debug tooling: auth status,
// watch-expiry countdown, last sync time, last reconciliation result and
// failure streak, message + draft + review + webhook-error counts.
// Read-only — does not trigger any sync work.
//
// Exactly 3 queries regardless of mailbox count (audit M2: the old per-mailbox
// fan-out was 6×N queries on a 1-connection pool and timed out into zeroed,
// healthy-looking rows). Partial failures set `error: true` on the row.
router.get('/sync-health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

    const mailboxes = await prisma.mailbox.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const [statsResult, logsResult] = await Promise.allSettled([
      prisma.$queryRaw<MailboxStatsRow[]>`
        SELECT m."id" AS "mailboxId",
          (SELECT MAX(e."receivedAt") FROM "EmailMessage" e WHERE e."mailboxId" = m."id") AS "lastSyncedMessageAt",
          (SELECT COUNT(*) FROM "EmailMessage" e WHERE e."mailboxId" = m."id" AND e."receivedAt" >= ${dayAgo}) AS "messagesLast24h",
          (SELECT COUNT(*) FROM "EmailMessage" e WHERE e."mailboxId" = m."id") AS "totalMessages",
          (SELECT COUNT(*) FROM "Candidate" c WHERE c."mailboxId" = m."id") AS "totalCandidates",
          (SELECT COUNT(*) FROM "EmailDraft" d JOIN "EmailThread" t ON t."id" = d."threadId"
             WHERE t."mailboxId" = m."id" AND d."status" = 'PENDING') AS "pendingDrafts",
          (SELECT COUNT(*) FROM "Candidate" c WHERE c."mailboxId" = m."id" AND c."status" = 'NEEDS_REVIEW') AS "candidatesNeedsReview"
        FROM "Mailbox" m
        WHERE m."isActive" = true`,
      prisma.systemLog.findMany({
        where: {
          event: { in: ['RECONCILIATION_RUN', 'RECONCILIATION_FAILED', 'WEBHOOK_HANDLER_ERROR'] },
          createdAt: { gte: twoDaysAgo },
        },
        select: { event: true, details: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
    ]);

    if (statsResult.status === 'rejected') {
      console.error('[sync-health] stats query failed:', safeError(statsResult.reason));
    }
    if (logsResult.status === 'rejected') {
      console.error('[sync-health] SystemLog query failed:', safeError(logsResult.reason));
    }
    const statsById = new Map<string, MailboxStatsRow>(
      statsResult.status === 'fulfilled' ? statsResult.value.map((r) => [r.mailboxId, r]) : []
    );
    const logs = logsResult.status === 'fulfilled' ? logsResult.value : [];

    // Single pass over logs (newest first).
    const errorsByEmail = new Map<string, number>();
    const lastErrorByEmail = new Map<string, string>();
    const lastRunByMailbox = new Map<string, { at: Date; details: Record<string, unknown> }>();
    const failuresByMailbox = new Map<string, { count: number; lastError: string | null }>();
    for (const log of logs) {
      const details = parseDetails(log.details);
      if (log.event === 'WEBHOOK_HANDLER_ERROR') {
        if (log.createdAt < dayAgo) continue;
        const email = typeof details.emailAddress === 'string' ? details.emailAddress : null;
        if (!email) continue;
        errorsByEmail.set(email, (errorsByEmail.get(email) ?? 0) + 1);
        if (!lastErrorByEmail.has(email) && typeof details.error === 'string') {
          lastErrorByEmail.set(email, details.error);
        }
        continue;
      }
      const mailboxId = typeof details.mailboxId === 'string' ? details.mailboxId : null;
      if (!mailboxId) continue; // summary rows
      if (log.event === 'RECONCILIATION_RUN') {
        if (!lastRunByMailbox.has(mailboxId)) lastRunByMailbox.set(mailboxId, { at: log.createdAt, details });
      } else if (!lastRunByMailbox.has(mailboxId)) {
        // RECONCILIATION_FAILED newer than any success seen so far.
        const f = failuresByMailbox.get(mailboxId) ?? { count: 0, lastError: null };
        f.count += 1;
        if (f.lastError === null && typeof details.error === 'string') f.lastError = details.error;
        failuresByMailbox.set(mailboxId, f);
      }
    }

    const toNum = (v: bigint | number | undefined): number | null =>
      v === undefined ? null : Number(v);

    const health: MailboxSyncHealth[] = mailboxes.map((mb) => {
      const stats = statsById.get(mb.id);
      const lastRun = lastRunByMailbox.get(mb.id);
      const failures = failuresByMailbox.get(mb.id);
      return {
        mailboxId: mb.id,
        emailAddress: mb.emailAddress,
        displayName: mb.displayName,
        isActive: mb.isActive,
        authStatus: mb.authStatus,
        lastAuthError: mb.lastAuthError,
        lastAuthErrorAt: mb.lastAuthErrorAt ? mb.lastAuthErrorAt.toISOString() : null,
        watchExpiry: mb.watchExpiry ? mb.watchExpiry.toISOString() : null,
        watchExpiresInHours: mb.watchExpiry
          ? Math.round(((mb.watchExpiry.getTime() - now) / (60 * 60 * 1000)) * 10) / 10
          : null,
        lastSyncedMessageAt: stats?.lastSyncedMessageAt
          ? new Date(stats.lastSyncedMessageAt).toISOString()
          : null,
        lastReconciliationAt: lastRun ? lastRun.at.toISOString() : null,
        lastReconciliationFoundMissing:
          typeof lastRun?.details.missingBefore === 'number' ? lastRun.details.missingBefore : 0,
        lastReconcileError: failures?.lastError ?? null,
        consecutiveReconcileFailures: failures?.count ?? 0,
        messagesLast24h: toNum(stats?.messagesLast24h),
        totalMessages: toNum(stats?.totalMessages),
        totalCandidates: toNum(stats?.totalCandidates),
        pendingDrafts: toNum(stats?.pendingDrafts),
        candidatesNeedsReview: toNum(stats?.candidatesNeedsReview),
        webhookErrorsLast24h: errorsByEmail.get(mb.emailAddress) ?? 0,
        lastWebhookError: lastErrorByEmail.get(mb.emailAddress) ?? null,
        error: !stats || logsResult.status === 'rejected',
      };
    });

    res.status(200).json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

// GET /api/internal/debug/mailbox?email=aaronrampersad@archive.com
// Admin-only debug: shows what messages + candidates the DB has for a mailbox.
router.get('/debug/mailbox', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : null;
    if (!email) return res.status(400).json({ success: false, message: 'email query param required' });

    const mailbox = await prisma.mailbox.findUnique({ where: { emailAddress: email } });
    if (!mailbox) return res.status(404).json({ success: false, message: 'Mailbox not found' });

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [totalMessages, recentMessages, recentLogs, webhookErrorLogs, candidates] = await Promise.all([
      prisma.emailMessage.count({ where: { mailboxId: mailbox.id } }),
      prisma.emailMessage.findMany({
        where: { mailboxId: mailbox.id },
        orderBy: { receivedAt: 'desc' },
        take: 20,
        select: {
          externalMessageId: true,
          fromAddress: true,
          fromName: true,
          subject: true,
          receivedAt: true,
          thread: { select: { candidateId: true } },
        },
      }),
      prisma.systemLog.findMany({
        where: {
          details: { contains: mailbox.id },
          createdAt: { gte: weekAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { event: true, level: true, createdAt: true, details: true },
      }),
      // Webhook errors log emailAddress not mailboxId, so search separately
      prisma.systemLog.findMany({
        where: {
          event: 'WEBHOOK_HANDLER_ERROR',
          details: { contains: mailbox.emailAddress },
          createdAt: { gte: weekAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { event: true, level: true, createdAt: true, details: true },
      }),
      prisma.candidate.findMany({
        where: { mailboxId: mailbox.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, name: true, email: true, status: true, createdAt: true },
      }),
    ]);

    res.json({
      success: true,
      data: {
        mailbox: { id: mailbox.id, emailAddress: mailbox.emailAddress, isActive: mailbox.isActive, lastHistoryId: mailbox.lastHistoryId, watchExpiry: mailbox.watchExpiry },
        totalMessages,
        recentMessages,
        candidates,
        recentLogs,
        webhookErrorLogs,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/internal/debug/candidate?email=sofiadelgadosandoval@gmail.com
router.get('/debug/candidate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = typeof req.query.email === 'string' ? req.query.email.trim() : null;
    if (!email) return res.status(400).json({ success: false, message: 'email query param required' });

    const candidate = await prisma.candidate.findUnique({
      where: { email },
      include: {
        threads: {
          include: {
            messages: { orderBy: { receivedAt: 'asc' }, take: 5 },
            drafts: { orderBy: { createdAt: 'desc' }, take: 3 },
          },
        },
      },
    });

    // Also look for any messages from this email even without a linked candidate
    const [messagesFromEmail, skipLogs] = await Promise.all([
      prisma.emailMessage.findMany({
        where: { fromAddress: email },
        orderBy: { receivedAt: 'desc' },
        take: 10,
        select: {
          externalMessageId: true,
          subject: true,
          receivedAt: true,
          mailboxId: true,
          thread: { select: { id: true, candidateId: true, subject: true } },
        },
      }),
      // Check if any messages from this sender were skipped by the classifier
      prisma.systemLog.findMany({
        where: {
          event: { in: ['MESSAGE_SKIPPED_NOT_RECRUITING', 'CANDIDATE_CLASSIFIED', 'DRAFT_SKIPPED_NEEDS_REVIEW', 'DRAFT_SKIPPED_LOW_CONFIDENCE'] },
          details: { contains: email },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { event: true, level: true, createdAt: true, details: true },
      }),
    ]);

    res.json({ success: true, data: { candidate, messagesFromEmail, skipLogs } });
  } catch (err) {
    next(err);
  }
});

// POST /api/internal/fix-replied-at
// Clears repliedAt on candidates where no outbound message in their threads
// is a genuine reply to the candidate.
//
// An outbound is a "genuine reply" if its stored headers.inReplyTo is non-empty.
// Original outreach emails have no inReplyTo; replies always do. Using inReplyTo
// rather than receivedAt ordering avoids false-positives from the now-fixed bug
// where missing Date: headers defaulted to new Date() (causing repliedAt to be
// set on messages whose receivedAt was incorrectly stored as "now").
router.post('/fix-replied-at', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const candidates = await prisma.candidate.findMany({
      where: { repliedAt: { not: null } },
      include: {
        threads: {
          include: {
            messages: { orderBy: { receivedAt: 'asc' } },
          },
        },
      },
    });

    let cleared = 0;
    for (const candidate of candidates) {
      let hasGenuineReply = false;

      for (const thread of candidate.threads) {
        const mailbox = await prisma.mailbox.findUnique({ where: { id: thread.mailboxId } });
        if (!mailbox) continue;
        const mailboxEmail = mailbox.emailAddress.toLowerCase();

        const hasInbound = thread.messages.some(
          (m) => m.fromAddress.toLowerCase() !== mailboxEmail
        );
        if (!hasInbound) continue;

        // A genuine reply has inReplyTo set in its headers. Original outreach
        // emails sent to candidates don't have inReplyTo.
        const outboundMsgs = thread.messages.filter(
          (m) => m.fromAddress.toLowerCase() === mailboxEmail
        );
        const genuineReply = outboundMsgs.some((m) => {
          try {
            const h = JSON.parse(typeof m.headers === 'string' ? m.headers : JSON.stringify(m.headers ?? {})) as { inReplyTo?: string };
            return h.inReplyTo && h.inReplyTo.trim().length > 0;
          } catch {
            return false;
          }
        });

        if (genuineReply) {
          hasGenuineReply = true;
          break;
        }
      }

      if (!hasGenuineReply) {
        await prisma.candidate.update({
          where: { id: candidate.id },
          data: { repliedAt: null },
        });
        cleared++;
      }
    }

    res.json({ success: true, data: { checked: candidates.length, cleared } });
  } catch (err) {
    next(err);
  }
});

// POST /api/internal/restore-discarded-drafts
// Restores all DISCARDED drafts from the last 24h back to APPROVED and clears
// repliedAt on their candidates. Scoped to 24h to avoid surfacing old
// intentionally-discarded work.
router.post('/restore-discarded-drafts', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const discardedDrafts = await prisma.emailDraft.findMany({
      where: { status: 'DISCARDED', updatedAt: { gte: since } },
      select: { id: true, thread: { select: { candidateId: true } } },
    });

    let restored = 0;
    const processedCandidates = new Set<string>();

    for (const draft of discardedDrafts) {
      await prisma.emailDraft.update({
        where: { id: draft.id },
        data: { status: 'APPROVED' },
      });
      restored++;

      const candidateId = draft.thread?.candidateId;
      if (candidateId && !processedCandidates.has(candidateId)) {
        processedCandidates.add(candidateId);
        await prisma.candidate.update({
          where: { id: candidateId },
          data: { repliedAt: null },
        });
      }
    }

    await logEvent('DISCARDED_DRAFTS_RESTORED', { checked: discardedDrafts.length, restored }, 'INFO');
    res.json({ success: true, data: { checked: discardedDrafts.length, restored } });
  } catch (err) {
    next(err);
  }
});

// POST /api/internal/purge-no-role-candidates
// Marks IGNORED all candidates where no role was detected, and discards any
// pending/approved drafts for them. These are almost always spam or bulk
// outreach that slipped past the NOT_RECRUITING_RELATED filter.
router.post('/purge-no-role-candidates', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const noRoleCandidates = await prisma.candidate.findMany({
      where: { role: null, status: { not: 'IGNORED' } },
      select: { id: true },
    });

    const ids = noRoleCandidates.map((c) => c.id);

    const [ignoredCount, discardedCount] = await Promise.all([
      prisma.candidate.updateMany({
        where: { id: { in: ids } },
        data: { status: 'IGNORED' },
      }),
      prisma.emailDraft.updateMany({
        where: {
          thread: { candidateId: { in: ids } },
          status: { in: ['PENDING', 'APPROVED'] },
        },
        data: { status: 'DISCARDED' },
      }),
    ]);

    await logEvent(
      'NO_ROLE_CANDIDATES_PURGED',
      { ignored: ignoredCount.count, draftsDiscarded: discardedCount.count },
      'INFO'
    );

    res.json({ success: true, data: { ignored: ignoredCount.count, draftsDiscarded: discardedCount.count } });
  } catch (err) {
    next(err);
  }
});

// GET /api/internal/debug/drafts
// Returns all drafts from the last 48h grouped by status so we can see
// exactly what happened to recently-approved work.
router.get('/debug/drafts', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const drafts = await prisma.emailDraft.findMany({
      where: { updatedAt: { gte: since } },
      select: {
        id: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        thread: {
          select: {
            subject: true,
            candidate: { select: { name: true, email: true } },
            mailbox: { select: { emailAddress: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const byStatus: Record<string, typeof drafts> = {};
    for (const d of drafts) {
      byStatus[d.status] = byStatus[d.status] ?? [];
      byStatus[d.status].push(d);
    }

    res.json({ success: true, data: { total: drafts.length, byStatus } });
  } catch (err) {
    next(err);
  }
});

export default router;
