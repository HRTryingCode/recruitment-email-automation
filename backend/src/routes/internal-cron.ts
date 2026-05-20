import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { reconcileMailbox, renewGmailWatches } from '../services/gmail.service';
import { logEvent } from '../services/monitoring.service';

const router = Router();

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Accept either an `Authorization: Bearer <CRON_SECRET>` header (our docs)
  // or Vercel's own `x-vercel-cron-signature` if it equals the secret.
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() === secret;
  }

  const vercelHeader = req.headers['x-vercel-cron-signature'];
  if (typeof vercelHeader === 'string' && vercelHeader === secret) {
    return true;
  }

  return false;
}

// POST /api/internal/cron/renew-watches
router.post(
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

// POST /api/internal/cron/reconcile
// Hourly safety-net sync. For each active mailbox, lists Gmail messages
// received in the last ~24h and ingests anything our DB is missing via the
// same fetchAndStoreMessage path the webhook uses (so Phase F/H classification,
// Phase I CC, Phase J persona, Phase M auto-discard all still apply).
//
// Primary push (Pub/Sub -> webhook -> syncIncremental) is highly reliable but
// not invincible: cold-start timeouts, watch expiry windows, Gmail history
// horizon (~30d), transient errors. Hourly reconciliation closes the gap.
router.post(
  '/reconcile',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }

      // Cap total work at ~50s to stay safely inside Vercel's 60s function
      // timeout. If we hit the deadline mid-mailbox the remaining ones get
      // picked up on the next hourly run.
      const start = Date.now();
      const deadline = start + 50_000;

      const mailboxes = await prisma.mailbox.findMany({
        where: { provider: 'GMAIL', isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      let totalIngested = 0;
      const results: Array<{
        mailboxId: string;
        emailAddress: string;
        scannedFromGmail: number;
        missingBefore: number;
        ingested: number;
        skipped?: boolean;
        error?: string;
      }> = [];

      for (const mb of mailboxes) {
        if (Date.now() > deadline) {
          results.push({
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
            scannedFromGmail: 0,
            missingBefore: 0,
            ingested: 0,
            skipped: true,
          });
          continue;
        }
        try {
          const result = await reconcileMailbox(mb.id, { deadline });
          totalIngested += result.ingested;

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

          results.push({
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
            ...result,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[Reconcile] Mailbox ${mb.emailAddress} failed:`, err);
          await logEvent(
            'RECONCILIATION_FAILED',
            { mailboxId: mb.id, emailAddress: mb.emailAddress, error: message },
            'WARN'
          );
          results.push({
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
            scannedFromGmail: 0,
            missingBefore: 0,
            ingested: 0,
            error: message,
          });
        }
      }

      res.status(200).json({
        success: true,
        data: {
          mailboxCount: mailboxes.length,
          totalIngested,
          elapsedMs: Date.now() - start,
          results,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
