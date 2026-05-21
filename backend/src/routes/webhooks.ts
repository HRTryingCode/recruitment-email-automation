import { Router, Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { processWebhook } from '../services/gmail.service';
import { logEvent } from '../services/monitoring.service';

const router = Router();

// Opt-in Pub/Sub push authentication. When PUBSUB_AUDIENCE is set, the
// subscription in GCP must be configured with an authentication service
// account whose OIDC token target audience matches this value. Google then
// sends `Authorization: Bearer <jwt>` on each push; we verify it here so
// random POSTs to the public webhook URL can't trigger Gmail history fetches.
// Left unset, the handler accepts any POST (back-compat with the current
// unauthenticated subscription setup).
const PUBSUB_AUDIENCE = process.env.PUBSUB_AUDIENCE;
const pubsubVerifier = PUBSUB_AUDIENCE ? new OAuth2Client() : null;

async function verifyPubSubJwt(req: Request, res: Response): Promise<boolean> {
  if (!PUBSUB_AUDIENCE || !pubsubVerifier) return true;

  const authHeader = req.header('authorization') ?? req.header('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    await logEvent(
      'WEBHOOK_AUTH_REJECTED',
      { reason: 'missing-bearer-token' },
      'WARN'
    );
    res.status(401).json({ error: 'Missing bearer token' });
    return false;
  }

  const idToken = authHeader.slice(7).trim();
  try {
    await pubsubVerifier.verifyIdToken({
      idToken,
      audience: PUBSUB_AUDIENCE,
    });
    return true;
  } catch (err) {
    await logEvent(
      'WEBHOOK_AUTH_REJECTED',
      {
        reason: 'jwt-verification-failed',
        error: err instanceof Error ? err.message : String(err),
      },
      'WARN'
    );
    res.status(401).json({ error: 'Invalid Pub/Sub auth token' });
    return false;
  }
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
// Always returns 200 so Pub/Sub doesn't retry. The actual sync work runs
// after we've ack'd, and any error inside it lands in SystemLog as
// WEBHOOK_HANDLER_ERROR (instead of disappearing into Vercel's truncated
// runtime logs). The dashboard sync-health tile surfaces a 24h count of
// these so silent drops are visible.
router.post('/gmail', async (req: Request, res: Response, _next: NextFunction) => {
  try {
    // Authenticate Pub/Sub push (if PUBSUB_AUDIENCE is configured). Runs
    // before any body inspection so an unauthenticated request can't even
    // exercise the JSON parser.
    if (!(await verifyPubSubJwt(req, res))) return;

    if (!req.body?.message?.data) {
      res.status(200).json({ success: true, message: 'No data' });
      return;
    }

    const body = req.body;
    // Fire-and-forget so we ack Pub/Sub quickly (its push deadline is 10s
    // by default and classification + Claude can take longer). Errors are
    // logged to SystemLog inside the catch.
    void processWebhook(body).catch(async (err: unknown) => {
      const notification = extractNotification(body);
      console.error('[Webhook] Gmail processing error:', err);
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
