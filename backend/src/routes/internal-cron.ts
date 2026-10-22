import crypto from 'crypto';
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import {
  reconcileMailbox,
  renewGmailWatches,
  sweepStuckMessages,
  refreshSendAsAddresses,
} from '../services/gmail.service';
import { sendWeeklyCoverageSummary } from '../services/coverage.service';
import { pruneSystemLog } from '../services/systemLogRetention.service';
import { logEvent, runWatchdog } from '../services/monitoring.service';
import { markMailboxNeedsReauth, AUTH_STATUS_NEEDS_REAUTH } from '../services/mailboxAuth.service';
import { safeError, isAuthRevokedError, MailboxNeedsReauthError } from '../lib/safeError';

const router = Router();

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` automatically when
// the CRON_SECRET env var is set; that is the only accepted form. Compared in
// constant time (L10).
function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return false;

  const provided = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

// GET /api/internal/cron/renew-watches
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
router.get(
  '/renew-watches',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const renewed = await renewGmailWatches();
      res.status(200).json({ success: true, data: { renewed } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/internal/cron/reconcile
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
// Hourly safety-net sync. For each active mailbox, lists Gmail messages
// received in the last ~24h and ingests anything our DB is missing via the
// same fetchAndStoreMessage path the webhook uses (so Phase F/H classification,
// Phase I CC, Phase J persona, Phase M auto-discard all still apply).
//
// Primary push (Pub/Sub -> webhook -> syncIncremental) is highly reliable but
// not invincible: cold-start timeouts, watch expiry windows, Gmail history
// horizon (~30d), transient errors. Hourly reconciliation closes the gap.
router.get(
  '/reconcile',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Budgets assume functions.maxDuration = 300s (vercel.json). No new
      // mailbox starts after 180s; each mailbox gets its own 60s ingest
      // deadline (checked between messages, so one in-flight message can
      // overrun by its Claude latency). Worst case ≈ 180 + 60 + ~20 < 300.
      const start = Date.now();
      const startBudgetMs = 180_000;
      const perMailboxBudgetMs = 60_000;
      // Small fixed concurrency (M1). Kept low because the Prisma pool is
      // small (POSTGRES_PRISMA_URL connection_limit); raise via env once the
      // pool is 3-5.
      const concurrency = Math.max(1, Number(process.env.RECONCILE_CONCURRENCY) || 2);

      const mailboxes = await prisma.mailbox.findMany({
        // NEEDS_REAUTH mailboxes can't sync until a human reconnects them;
        // the watchdog alerts on them instead of logging a failure hourly.
        where: { provider: 'GMAIL', isActive: true, authStatus: { not: AUTH_STATUS_NEEDS_REAUTH } },
        // Least-recently-attempted first (M1): a run that hits the start
        // budget skips the mailboxes that were just done, never the same
        // late-connected ones every hour (the old createdAt order).
        orderBy: [{ lastReconciledAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      });

      let totalIngested = 0;
      let totalMissing = 0;
      let totalScanned = 0;
      type Result = {
        mailboxId: string;
        emailAddress: string;
        scannedFromGmail: number;
        missingBefore: number;
        ingested: number;
        skipped?: boolean;
        error?: string;
      };
      const slots: Array<Result | undefined> = new Array(mailboxes.length);

      async function reconcileOne(mb: (typeof mailboxes)[number]): Promise<Result> {
        try {
          // Stamp the attempt first so a failing or timed-out mailbox still
          // rotates to the back of the queue.
          await prisma.mailbox.update({ where: { id: mb.id }, data: { lastReconciledAt: new Date() } });
          const innerDeadline = Date.now() + perMailboxBudgetMs;
          const result = await reconcileMailbox(mb.id, { deadline: innerDeadline });
          totalIngested += result.ingested;
          totalMissing += result.missingBefore;
          totalScanned += result.scannedFromGmail;

          await logEvent(
            'RECONCILIATION_RUN',
            {
              mailboxId: mb.id,
              emailAddress: mb.emailAddress,
              scannedFromGmail: result.scannedFromGmail,
              missingBefore: result.missingBefore,
              ingested: result.ingested,
            },
            'INFO'
          );
          if (result.missingBefore > 0) {
            // Same shape, different event — easier to spot in dashboards/log
            // queries when drift is actually detected.
            await logEvent(
              'RECONCILIATION_FOUND_MISSING',
              {
                mailboxId: mb.id,
                emailAddress: mb.emailAddress,
                scannedFromGmail: result.scannedFromGmail,
                missingBefore: result.missingBefore,
                ingested: result.ingested,
              },
              'WARN'
            );
          }

          return { mailboxId: mb.id, emailAddress: mb.emailAddress, ...result };
        } catch (err) {
          const safe = safeError(err);
          const message = safe.message;
          const authRevoked = isAuthRevokedError(err);
          console.error(`[Reconcile] Mailbox ${mb.emailAddress} failed:`, safe);
          // getGmailClient already marked the mailbox for MailboxNeedsReauthError;
          // a 401 from a later Gmail call lands here unmarked.
          if (authRevoked && !(err instanceof MailboxNeedsReauthError)) {
            await markMailboxNeedsReauth(mb, err, 'reconcile');
          }
          await logEvent(
            'RECONCILIATION_FAILED',
            { mailboxId: mb.id, emailAddress: mb.emailAddress, error: message, authRevoked },
            authRevoked ? 'ERROR' : 'WARN'
          );
          return {
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
            scannedFromGmail: 0,
            missingBefore: 0,
            ingested: 0,
            error: message,
          };
        }
      }

      // Worker pool: each worker takes the next mailbox until the list or the
      // start budget runs out. Results keep the queue order.
      let next = 0;
      async function worker(): Promise<void> {
        while (next < mailboxes.length && Date.now() - start <= startBudgetMs) {
          const i = next++;
          slots[i] = await reconcileOne(mailboxes[i]!);
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(concurrency, mailboxes.length) }, () => worker())
      );

      const processedCount = slots.filter(Boolean).length;
      const deadlineReachedAt = processedCount < mailboxes.length ? processedCount : -1;
      const results: Result[] = slots.filter((r): r is Result => r !== undefined);

      if (deadlineReachedAt >= 0) {
        const skipped = mailboxes.slice(deadlineReachedAt);
        for (const mb of skipped) {
          results.push({
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
            scannedFromGmail: 0,
            missingBefore: 0,
            ingested: 0,
            skipped: true,
          });
        }
        await logEvent(
          'RECONCILE_DEADLINE_REACHED',
          {
            elapsedMs: Date.now() - start,
            skippedCount: skipped.length,
            processedCount: deadlineReachedAt,
            totalMailboxes: mailboxes.length,
            skippedMailboxIds: skipped.map((m) => m.id),
          },
          'WARN'
        );
      }

      const elapsedMs = Date.now() - start;

      // Final aggregate summary log so operators can see total run cost and
      // drift at a glance ("reconcile took 3.4s, scanned 2 mailboxes, found 0
      // missing") without joining the per-mailbox entries above.
      await logEvent(
        'RECONCILIATION_RUN',
        {
          summary: true,
          mailboxCount: mailboxes.length,
          processedCount:
            deadlineReachedAt >= 0 ? deadlineReachedAt : mailboxes.length,
          totalScanned,
          totalMissing,
          totalIngested,
          elapsedMs,
          deadlineReached: deadlineReachedAt >= 0,
        },
        'INFO'
      );

      res.status(200).json({
        success: true,
        data: {
          mailboxCount: mailboxes.length,
          totalIngested,
          totalMissing,
          totalScanned,
          elapsedMs,
          deadlineReached: deadlineReachedAt >= 0,
          results,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/internal/cron/watchdog
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
// Every 15 min: evaluates mailbox auth/watch/reconcile health and pipeline
// liveness (incl. a dead-man's switch on the hourly reconcile) and posts to
// Slack on state change only. No-op alerting if SLACK_ALERT_WEBHOOK_URL is
// unset. See services/monitoring.service.ts runWatchdog().
router.get(
  '/watchdog',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const result = await runWatchdog();
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/internal/cron/sweep-stuck-messages
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
// Every 10 min: re-runs classification + drafting for inbound messages that
// were stored but never finished processing (function froze/timed out, or
// classify threw). See gmail.service sweepStuckMessages() (audit M3).
router.get(
  '/sweep-stuck-messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const result = await sweepStuckMessages({ deadline: Date.now() + 200_000 });
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/internal/cron/systemlog-retention
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
// Daily: deletes INFO SystemLog rows older than 30d and others older than
// 90d (audit M26). Dry run (counts only) unless SYSTEMLOG_RETENTION_ENABLED
// is exactly "true" — the first real run deletes ~500k rows, which needs
// explicit human sign-off.
router.get(
  '/systemlog-retention',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const enabled = process.env.SYSTEMLOG_RETENTION_ENABLED === 'true';
      const result = await pruneSystemLog({ enabled, deadline: Date.now() + 200_000 });
      await logEvent('SYSTEMLOG_RETENTION_RUN', result, 'INFO');
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/internal/cron/coverage-summary
// NOTE: Vercel cron jobs invoke via GET — must not be POST.
// Weekly (audit H2): refresh each healthy mailbox's Gmail sendAs aliases,
// then diff expected senders against monitored addresses and post the
// summary to Slack via alert.service. See services/coverage.service.ts.
router.get(
  '/coverage-summary',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const mailboxes = await prisma.mailbox.findMany({
        where: { isActive: true, authStatus: { not: AUTH_STATUS_NEEDS_REAUTH } },
        select: { id: true },
      });
      // Bounded so a slow Gmail API can't eat the summary's time budget.
      const deadline = Date.now() + 30_000;
      let sendAsRefreshed = 0;
      let sendAsFailed = 0;
      for (const m of mailboxes) {
        if (Date.now() > deadline) {
          sendAsFailed += 1;
          continue;
        }
        const aliases = await refreshSendAsAddresses(m.id);
        if (aliases) sendAsRefreshed += 1;
        else sendAsFailed += 1;
      }
      const summary = await sendWeeklyCoverageSummary();
      res.status(200).json({ success: true, data: { sendAsRefreshed, sendAsFailed, ...summary } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
