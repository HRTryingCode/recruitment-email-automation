// Near-real-time Lever status (H2). Two event sources replace faster polling:
//   - our own writes: a new Candidate (or a changed email) is checked against
//     Lever in the background right away (scheduleLeverRefresh);
//   - Lever's writes: Lever webhooks (routes/webhooks-lever.ts) name an
//     opportunity, and every matching Candidate is re-read from Lever.
// The 3h lever-sync and 15-min lever-sync-new crons remain the safety net.
// Read-only against Lever: every refresh goes through refreshCandidateLever.
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { waitUntil } from '@vercel/functions';
import { prisma } from '../db/client';
import { LeverClient } from './lever.service';
import { refreshCandidateLever } from './leverSync.service';
import { logEvent } from './monitoring.service';

type LeverLookup = Pick<LeverClient, 'configured' | 'findByEmail'>;

export type LeverRefreshReason = 'created' | 'email_changed';

/**
 * Refreshes one candidate's Lever columns without blocking the caller.
 * Errors are swallowed (logged as LEVER_REFRESH_FAILED); the crons retry.
 * No-op when LEVER_API_KEY is unset, so fresh rows stay "Checking Lever…"
 * rather than getting an `unconfigured` ERROR.
 */
export function scheduleLeverRefresh(
  candidateId: string,
  reason: LeverRefreshReason,
  deps: { client?: LeverLookup; refresh?: typeof refreshCandidateLever } = {}
): void {
  const client = deps.client ?? new LeverClient();
  if (!client.configured) return;
  const refresh = deps.refresh ?? refreshCandidateLever;
  const work = Promise.resolve()
    .then(() => refresh(candidateId, client))
    .then(
      () => undefined,
      async (err: unknown) => {
        await logEvent(
          'LEVER_REFRESH_FAILED',
          { candidateId, reason, error: err instanceof Error ? err.message : String(err) },
          'WARN'
        );
      }
    );
  waitUntil(work);
}

// ---------------------------------------------------------------------------
// Lever webhooks
// ---------------------------------------------------------------------------

/** Events we subscribe to; anything else is acked and ignored. */
export const LEVER_WEBHOOK_EVENTS: ReadonlySet<string> = new Set([
  'applicationCreated',
  'candidateStageChange',
  'candidateArchiveChange',
  'candidateHired',
  'candidateDeleted',
]);

/** Deliveries whose triggeredAt is further than this from now are rejected (replay guard). */
export const LEVER_WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

/** LEVER_WEBHOOK_SIGNATURE_TOKENS: one signature token per configured webhook, comma-separated. */
export function parseSignatureTokens(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

export type LeverSignatureResult = { ok: true } | { ok: false; reason: 'missing_fields' | 'stale' | 'bad_signature' };

/**
 * Lever signs each delivery: signature = hex HMAC-SHA256(signatureToken,
 * token + triggeredAt). We don't know which webhook (and so which token) a
 * delivery belongs to, so any configured token may match. Compared in
 * constant time.
 */
export function verifyLeverSignature(
  body: { token?: unknown; triggeredAt?: unknown; signature?: unknown },
  tokens: string[],
  now: number = Date.now()
): LeverSignatureResult {
  const { token, signature } = body ?? {};
  const triggeredAt = typeof body?.triggeredAt === 'string' ? Number(body.triggeredAt) : body?.triggeredAt;
  if (typeof token !== 'string' || typeof signature !== 'string' || typeof triggeredAt !== 'number' || !Number.isFinite(triggeredAt)) {
    return { ok: false, reason: 'missing_fields' };
  }
  if (Math.abs(now - triggeredAt) > LEVER_WEBHOOK_MAX_SKEW_MS) return { ok: false, reason: 'stale' };

  const given = Buffer.from(signature, 'utf8');
  const message = `${token}${String(body.triggeredAt)}`;
  let matched = false;
  for (const key of tokens) {
    const expected = Buffer.from(createHmac('sha256', key).update(message).digest('hex'), 'utf8');
    // No early exit, so timing doesn't reveal which token matched.
    if (expected.length === given.length && timingSafeEqual(expected, given)) matched = true;
  }
  return matched ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

export interface LeverWebhookEvent {
  event: string;
  opportunityId: string;
  triggeredAt: number;
  /** Lever's delivery `id` when sent, else `event:opportunityId:triggeredAt`. */
  dedupeKey: string;
}

/** Upper bound on candidates refreshed per delivery (one person, a few aliases). */
const MAX_CANDIDATES_PER_EVENT = 10;

type WebhookLeverClient = LeverLookup & Pick<LeverClient, 'getOpportunityEmails'>;

/**
 * Handles one verified delivery: dedupe on `dedupeKey` (LeverWebhookEvent
 * row), log LEVER_WEBHOOK_RECEIVED, then refresh every Candidate linked to
 * the opportunity — by stored leverOpportunityId, plus by the opportunity's
 * current emails (covers applicationCreated for someone we only know by
 * email). candidateDeleted's opportunity 404s; the stored link still finds
 * the row and the refresh re-reads Lever by email.
 */
export async function processLeverWebhook(
  evt: LeverWebhookEvent,
  client: WebhookLeverClient = new LeverClient()
): Promise<{ duplicate: boolean; candidateIds: string[] }> {
  try {
    await prisma.leverWebhookEvent.create({
      data: {
        id: evt.dedupeKey,
        event: evt.event,
        opportunityId: evt.opportunityId,
        triggeredAt: new Date(evt.triggeredAt),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { duplicate: true, candidateIds: [] };
    }
    // Dedupe is an optimisation (a refresh is idempotent): carry on.
    console.warn('[LeverWebhook] dedupe write failed:', err instanceof Error ? err.message : String(err));
  }

  // Logged before any lookup so the sync-health counter and the watchdog's
  // "no webhook in 24h" check see the delivery even if processing fails.
  await logEvent('LEVER_WEBHOOK_RECEIVED', { event: evt.event, opportunityId: evt.opportunityId });

  const ids = new Set<string>();
  const linked = await prisma.candidate.findMany({
    where: { leverOpportunityId: evt.opportunityId },
    select: { id: true },
    take: MAX_CANDIDATES_PER_EVENT,
  });
  for (const c of linked) ids.add(c.id);

  const emails = await client.getOpportunityEmails(evt.opportunityId);
  if (emails && emails.length > 0) {
    const byEmail = await prisma.candidate.findMany({
      where: { OR: emails.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
      select: { id: true },
      take: MAX_CANDIDATES_PER_EVENT,
    });
    for (const c of byEmail) ids.add(c.id);
  }

  const candidateIds = [...ids].slice(0, MAX_CANDIDATES_PER_EVENT);
  // Sequential: each refresh is several Lever GETs behind the shared bucket.
  for (const id of candidateIds) await refreshCandidateLever(id, client);
  return { duplicate: false, candidateIds };
}
