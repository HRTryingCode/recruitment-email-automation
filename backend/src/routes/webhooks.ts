import { Router, Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { waitUntil } from '@vercel/functions';
import { processWebhook } from '../services/gmail.service';
import { logEvent } from '../services/monitoring.service';
import { safeError } from '../lib/safeError';

const router = Router();

// Pub/Sub push authentication (audit B6 / M8).
//
// PUBSUB_AUDIENCE set: every push must carry `Authorization: Bearer <OIDC
// JWT>` signed by Google with `aud` equal to PUBSUB_AUDIENCE. When
// PUBSUB_SERVICE_ACCOUNT_EMAIL is also set, the token's verified `email`
// claim must equal it. Audience alone is weak (any GCP principal can mint a
// Google-signed ID token for an arbitrary audience), so set both.
//
// PUBSUB_AUDIENCE unset: back-compat fail-open. Pushes are accepted and a
// sampled console warning is emitted, so deploying this code before the GCP
// subscription is configured for OIDC never drops real pushes (the May
// 21–25 incident). Env vars are read per request so flipping them on Vercel
// takes effect without a code change.
//
// Rejections write at most one WEBHOOK_AUTH_REJECTED SystemLog row per minute
// per instance (with a suppressed count) — previously every unauthenticated
// POST wrote a row, which produced 490k rows in four days.
const pubsubVerifier = new OAuth2Client();
const SAMPLE_WINDOW_MS = 60_000;
let lastRejectLogAt = 0;
let suppressedRejects = 0;
let lastFailOpenWarnAt = 0;
let lastNoEmailWarnAt = 0;

/** Test hook: reset the per-instance sampling state. */
export function _resetWebhookAuthSampler(): void {
  lastRejectLogAt = 0;
  suppressedRejects = 0;
  lastFailOpenWarnAt = 0;
  lastNoEmailWarnAt = 0;
}

async function recordRejection(reason: string, error?: string): Promise<void> {
  const now = Date.now();
  if (now - lastRejectLogAt < SAMPLE_WINDOW_MS) {
    suppressedRejects += 1;
    return;
  }
  const suppressedSinceLastLog = suppressedRejects;
  lastRejectLogAt = now;
  suppressedRejects = 0;
  await logEvent(
    'WEBHOOK_AUTH_REJECTED',
    { reason, ...(error ? { error } : {}), suppressedSinceLastLog },
    'WARN'
  );
}

async function verifyPubSubJwt(req: Request, res: Response): Promise<boolean> {
  const audience = process.env.PUBSUB_AUDIENCE?.trim();
  if (!audience) {
    const now = Date.now();
    if (now - lastFailOpenWarnAt >= SAMPLE_WINDOW_MS) {
      lastFailOpenWarnAt = now;
      console.warn(
        '[Webhook] PUBSUB_AUDIENCE is not set — accepting unauthenticated ' +
          'Pub/Sub pushes (fail-open). Configure OIDC on the push subscription, ' +
          'then set PUBSUB_AUDIENCE and PUBSUB_SERVICE_ACCOUNT_EMAIL.'
      );
    }
    return true;
  }

  const authHeader = req.header('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    await recordRejection('missing-bearer-token');
    res.status(401).json({ error: 'Missing bearer token' });
    return false;
  }

  const idToken = authHeader.slice(7).trim();
  let payload;
  try {
    const ticket = await pubsubVerifier.verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (err) {
    await recordRejection(
      'jwt-verification-failed',
      err instanceof Error ? err.message : String(err)
    );
    res.status(401).json({ error: 'Invalid Pub/Sub auth token' });
    return false;
  }

  const expectedEmail = process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!expectedEmail) {
    const now = Date.now();
    if (now - lastNoEmailWarnAt >= SAMPLE_WINDOW_MS) {
      lastNoEmailWarnAt = now;
      console.warn(
        '[Webhook] PUBSUB_SERVICE_ACCOUNT_EMAIL is not set — Pub/Sub JWT ' +
          'audience is verified but the signer identity is not.'
      );
    }
    return true;
  }

  if (
    !payload?.email ||
    payload.email_verified !== true ||
    payload.email.toLowerCase() !== expectedEmail
  ) {
    await recordRejection('unexpected-service-account');
    res.status(401).json({ error: 'Invalid Pub/Sub auth token' });
    return false;
  }
  return true;
}

// Trim a multiline stack to the top 10 frames — enough to identify the call
// site, short enough to keep SystemLog.details rows compact.
function shortenStack(err: unknown): string | undefined {
  if (!(err instanceof Error) || !err.stack) return undefined;
  return err.stack.split('\n').slice(0, 10).join('\n');
}

// Best-effort extraction of the Pub/Sub notification payload so handler
// errors carry enough breadcrumbs to debug after the fact.
function extractNotification(body: unknown): {
  emailAddress?: string;
  historyId?: string;
} {
  try {
    const message = (body as { message?: { data?: string } } | undefined)?.message;
    if (!message?.data) return {};
    const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as { emailAddress?: string; historyId?: string };
    return {
      emailAddress: parsed.emailAddress,
      historyId: parsed.historyId,
    };
  } catch {
    return {};
  }
}

// POST /api/webhooks/gmail — Google Cloud Pub/Sub push endpoint.
//
// Ack timing (Phase Q + Phase AR doc): we always return 200 — even on
// internal errors — for three reasons.
//
//   (a) Pub/Sub treats any non-2xx as "redeliver this message". The
//       processWebhook path is idempotent (history-id dedupe + message-id
//       upsert keys), so a redelivery costs us a wasted Gmail history
//       fetch but never produces duplicate candidates or drafts.
//   (b) The contract here is at-least-once on the Pub/Sub side, made
//       effectively exactly-once by the dedupe inside processWebhook. Ack
//       in the synchronous response so we never sit past Pub/Sub's 10s
//       push deadline waiting on Claude / Gmail latency. The processing
//       itself is registered with Vercel's waitUntil (audit H4): a plain
//       fire-and-forget promise is frozen as soon as the response is sent,
//       and only resumed (if ever) when the instance thaws for an unrelated
//       request — which is why almost all mail used to arrive via the
//       hourly reconcile. waitUntil keeps the function alive until the
//       promise settles, bounded by functions.maxDuration in vercel.json.
//   (c) Errors aren't swallowed: every failure inside processWebhook (or
//       in synchronous pre-dispatch parsing below) is written to SystemLog
//       as WEBHOOK_HANDLER_ERROR with the originating emailAddress +
//       historyId. The dashboard sync-health tile surfaces a 24h count so
//       silent drops stay visible even though Pub/Sub sees a 200.
router.post('/gmail', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    // Authenticate Pub/Sub push (when PUBSUB_AUDIENCE is configured). Runs
    // before any body inspection so an unauthenticated request can't even
    // exercise the JSON parser.
    if (!(await verifyPubSubJwt(req, res))) return;

    if (!req.body?.message?.data) {
      res.status(200).json({ success: true, message: 'No data' });
      return;
    }

    const body = req.body;
    const notification = extractNotification(body);
    // Stable-prefix receipt line so delivery (Vercel logs) can be compared
    // with processing (MAILBOX_SYNCED_INCREMENTAL / WEBHOOK_STALE_SKIPPED).
    console.log(`[Webhook] received historyId=${notification.historyId ?? '?'}`);
    // Ack Pub/Sub quickly (push deadline 10s; classification + Claude can
    // take longer) and keep processing alive via waitUntil. Errors are
    // logged to SystemLog inside the catch.
    const work = processWebhook(body).catch(async (err: unknown) => {
      console.error('[Webhook] Gmail processing error:', safeError(err));
      await logEvent(
        'WEBHOOK_HANDLER_ERROR',
        {
          error: err instanceof Error ? err.message : String(err),
          stack: shortenStack(err),
          emailAddress: notification.emailAddress,
          historyId: notification.historyId,
        },
        'ERROR'
      );
    });
    waitUntil(work);

    res.status(200).json({ success: true });
  } catch (err) {
    // Synchronous failure before we even kicked off processWebhook
    // (JSON parsing, etc.). Log + still 200 to silence Pub/Sub retries.
    const notification = extractNotification(req.body);
    await logEvent(
      'WEBHOOK_HANDLER_ERROR',
      {
        error: err instanceof Error ? err.message : String(err),
        stack: shortenStack(err),
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
        phase: 'pre-dispatch',
      },
      'ERROR'
    );
    res.status(200).json({ success: true });
  }
});

export default router;
