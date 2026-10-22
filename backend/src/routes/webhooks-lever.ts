// POST /api/webhooks/lever — Lever webhook receiver (H2).
//
// Public route; authenticated in-handler by Lever's per-webhook HMAC
// signature (verifyLeverSignature). LEVER_WEBHOOK_SIGNATURE_TOKENS unset →
// 503 and no work, so the endpoint is inert until a Lever super admin has
// configured the webhooks. Read per request, like the Pub/Sub env vars.
//
// The payload is used only for routing: the event name and
// data.opportunityId. Everything else is re-read from Lever by
// processLeverWebhook, in waitUntil after the 200 (Lever treats any non-2xx
// as a failed delivery and retries it).
import { Router, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import {
  LEVER_WEBHOOK_EVENTS,
  parseSignatureTokens,
  processLeverWebhook,
  verifyLeverSignature,
  type LeverWebhookEvent,
} from '../services/leverRealtime.service';
import { logEvent } from '../services/monitoring.service';
import { safeError } from '../lib/safeError';

const router = Router();

// At most one LEVER_WEBHOOK_REJECTED row per minute per instance, so a
// scanner can't flood SystemLog (same policy as the Gmail webhook).
const SAMPLE_WINDOW_MS = 60_000;
let lastRejectLogAt = 0;
let suppressedRejects = 0;

/** Test hook: reset the per-instance sampling state. */
export function _resetLeverWebhookSampler(): void {
  lastRejectLogAt = 0;
  suppressedRejects = 0;
}

async function recordRejection(reason: string): Promise<void> {
  const now = Date.now();
  if (now - lastRejectLogAt < SAMPLE_WINDOW_MS) {
    suppressedRejects += 1;
    return;
  }
  const suppressedSinceLastLog = suppressedRejects;
  lastRejectLogAt = now;
  suppressedRejects = 0;
  await logEvent('LEVER_WEBHOOK_REJECTED', { reason, suppressedSinceLastLog }, 'WARN');
}

router.post('/lever', async (req: Request, res: Response) => {
  const tokens = parseSignatureTokens(process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS);
  if (tokens.length === 0) {
    res.status(503).json({ success: false, error: 'Lever webhooks are not configured' });
    return;
  }

  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const verified = verifyLeverSignature(body, tokens);
  if (!verified.ok) {
    await recordRejection(verified.reason);
    res.status(401).json({ success: false, error: 'Invalid signature' });
    return;
  }

  const event = typeof body.event === 'string' ? body.event : '';
  const data = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : {};
  const opportunityId = typeof data.opportunityId === 'string' ? data.opportunityId : '';
  if (!LEVER_WEBHOOK_EVENTS.has(event) || !opportunityId) {
    res.status(200).json({ success: true, ignored: true });
    return;
  }

  const triggeredAt = Number(body.triggeredAt);
  const evt: LeverWebhookEvent = {
    event,
    opportunityId,
    triggeredAt,
    dedupeKey: typeof body.id === 'string' && body.id ? body.id : `${event}:${opportunityId}:${triggeredAt}`,
  };
  const work = processLeverWebhook(evt).then(
    () => undefined,
    async (err: unknown) => {
      console.error('[LeverWebhook] processing error:', safeError(err));
      await logEvent(
        'LEVER_WEBHOOK_ERROR',
        { event, opportunityId, error: err instanceof Error ? err.message : String(err) },
        'ERROR'
      );
    }
  );
  waitUntil(work);
  res.status(200).json({ success: true });
});

export default router;
