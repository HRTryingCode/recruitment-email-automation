import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import {
  normalizeLookupEmail,
  summarizeMessages,
  computeVerdict,
  type LookupMessageRow,
  type SkipReason,
} from '../lib/lookup';
import { leverLookupIntegration, type LeverLookupIntegration } from '../services/leverLookup';
import {
  buildPrefill,
  createInLever,
  createRequestSchema,
  findCandidateForPrefill,
  isLeverCreateEnabled,
  toHttpError,
} from '../services/addToLever.service';

const router = Router();

// Query caps. A single address realistically has a handful of messages; the
// caps only keep a pathological address (a shared alias, a mailing list)
// from turning one keystroke into a table scan's worth of rows.
const MAX_MESSAGES = 500;
const MAX_THREADS = 200;
const MAX_DRAFTS = 200;
// SystemLog skip events carry the Gmail message id (never the address, per
// B6), so we match on the newest inbound ids only.
const MAX_SKIP_IDS = 25;
const MAX_SKIP_LOGS = 50;
const SKIP_WINDOW_DAYS = 90;

const SKIP_EVENTS: Record<string, SkipReason> = {
  MESSAGE_SKIPPED_NOT_RECRUITING: 'NOT_RECRUITING',
  MESSAGE_SKIPPED_NO_ROLE: 'NO_ROLE',
};

/**
 * External-system status for the looked-up address, keyed by integration.
 * Contract for integrations (`lever`: services/leverLookup.ts, F2):
 *   - each key is optional and absent when the integration is not configured;
 *   - a value is `{ status: 'FOUND' | 'NOT_FOUND' | 'ERROR', ... }` plus
 *     integration-specific display fields (no secrets, no raw API payloads);
 *   - an integration failure never fails the lookup — it reports
 *     `{ status: 'ERROR', message }` under its key instead;
 *   - integrations are read-only (no writes to the external system).
 */
export type LookupIntegrations = { lever?: LeverLookupIntegration };

// GET /api/lookup?email=<email>
// "Do we know this person?" — Candidate row, message/draft metadata, recent
// skip reasons and a verdict. Metadata only: no message or draft bodies.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = normalizeLookupEmail(req.query.email);
    if (!email) {
      return next(createError('email must be a single valid email address', 400));
    }
    // Live Lever check, in parallel with the DB queries. Never rejects.
    const leverP = leverLookupIntegration(email);

    const [candidate, rows] = await Promise.all([
      prisma.candidate.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: {
          mailbox: { select: { id: true, emailAddress: true } },
          threads: { select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: MAX_THREADS },
        },
      }),
      prisma.emailMessage.findMany({
        where: {
          OR: [
            { fromAddress: { equals: email, mode: 'insensitive' } },
            // Substring prefilter on the JSON text; summarizeMessages does
            // the exact per-address match.
            { toAddresses: { contains: email, mode: 'insensitive' } },
          ],
        },
        select: {
          threadId: true,
          mailboxId: true,
          externalMessageId: true,
          fromAddress: true,
          toAddresses: true,
          subject: true,
          receivedAt: true,
          processingState: true,
        },
        orderBy: { receivedAt: 'desc' },
        take: MAX_MESSAGES,
      }),
    ]);

    const messages = summarizeMessages(rows as LookupMessageRow[], email);
    const firstMailboxId = candidate?.firstMailboxId ?? null;

    const threadIds = [
      ...new Set([...(candidate?.threads.map((t) => t.id) ?? []), ...messages.threadIds]),
    ].slice(0, MAX_THREADS);
    const mailboxIds = [...new Set([...messages.mailboxIds, ...(firstMailboxId ? [firstMailboxId] : [])])];
    const skipIds = messages.inboundExternalIds.slice(0, MAX_SKIP_IDS);
    const since = new Date(Date.now() - SKIP_WINDOW_DAYS * 86_400_000);

    const [mailboxes, drafts, skipLogs] = await Promise.all([
      mailboxIds.length
        ? prisma.mailbox.findMany({
            where: { id: { in: mailboxIds } },
            select: { id: true, emailAddress: true },
          })
        : Promise.resolve([]),
      threadIds.length
        ? prisma.emailDraft.findMany({
            where: { threadId: { in: threadIds } },
            select: { id: true, status: true, threadId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: MAX_DRAFTS,
          })
        : Promise.resolve([]),
      skipIds.length
        ? prisma.systemLog.findMany({
            // (event, createdAt) index narrows the scan before the
            // details substring match.
            where: {
              event: { in: Object.keys(SKIP_EVENTS) },
              createdAt: { gte: since },
              OR: skipIds.map((id) => ({ details: { contains: id } })),
            },
            select: { event: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: MAX_SKIP_LOGS,
          })
        : Promise.resolve([]),
    ]);

    const mailboxById = new Map(mailboxes.map((m) => [m.id, m]));
    if (messages.lastInbound?.mailboxId) {
      messages.lastInbound.mailboxEmail =
        mailboxById.get(messages.lastInbound.mailboxId)?.emailAddress ?? null;
    }

    const reasons = new Set<SkipReason>();
    for (const log of skipLogs) {
      const reason = SKIP_EVENTS[log.event];
      if (reason) reasons.add(reason);
    }
    if (messages.inboundSkippedByFilter > 0) reasons.add('FILTERED');
    const skipped = [...reasons];

    const byStatus: Record<string, number> = {};
    for (const d of drafts) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;

    const { verdict, summary } = computeVerdict({
      candidate: candidate
        ? {
            name: candidate.name,
            status: candidate.status,
            role: candidate.role,
            mailboxEmail: candidate.mailbox?.emailAddress ?? null,
          }
        : null,
      messages,
      skipped,
      now: new Date(),
    });

    const lever = await leverP;
    const integrations: LookupIntegrations = lever ? { lever } : {};

    res.json({
      success: true,
      data: {
        email,
        verdict,
        summary,
        candidate: candidate
          ? {
              id: candidate.id,
              name: candidate.name,
              email: candidate.email,
              status: candidate.status,
              role: candidate.role,
              company: candidate.company,
              title: candidate.title,
              mailbox: candidate.mailbox ?? null,
              firstMailbox: firstMailboxId ? (mailboxById.get(firstMailboxId) ?? null) : null,
              repliedAt: candidate.repliedAt,
              lastInboundAt: candidate.lastInboundAt,
              lastOutboundAt: candidate.lastOutboundAt,
              createdAt: candidate.createdAt,
            }
          : null,
        messages: {
          inbound: messages.inbound,
          outbound: messages.outbound,
          firstAt: messages.firstAt,
          lastAt: messages.lastAt,
          latestSubject: messages.latestSubject,
          latestThreadId: messages.threadIds[0] ?? null,
          mailboxes: messages.mailboxIds
            .map((id) => mailboxById.get(id))
            .filter((m): m is { id: string; emailAddress: string } => Boolean(m)),
          truncated: rows.length >= MAX_MESSAGES,
        },
        drafts: {
          total: drafts.length,
          byStatus,
          latest: drafts[0] ?? null,
        },
        skipped: {
          reasons: skipped,
          lastSkippedAt: skipLogs[0]?.createdAt ?? null,
          windowDays: SKIP_WINDOW_DAYS,
        },
        integrations,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/lookup/lever-prefill?email= — F3 Add to Lever for any address,
// including people the app has never seen.
router.get('/lever-prefill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = normalizeLookupEmail(req.query.email);
    if (!email) return next(createError('email must be a single valid email address', 400));
    const candidate = await findCandidateForPrefill({ email });
    const data = await buildPrefill({ actorUserId: req.userId!, email, candidate });
    res.json({ success: true, data });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

// POST /api/lookup/lever — F3 create by email (body = confirmed payload + email).
router.post('/lever', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isLeverCreateEnabled()) return next(createError('Add to Lever is turned off', 403));
    const email = normalizeLookupEmail(req.body?.email);
    if (!email) return next(createError('email must be a single valid email address', 400));
    const body = createRequestSchema.safeParse(req.body);
    if (!body.success) return next(createError(body.error.issues[0]?.message ?? 'Invalid request', 400));
    const candidate = await prisma.candidate.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    const data = await createInLever({
      actorUserId: req.userId!,
      email,
      candidateId: candidate?.id ?? null,
      req: body.data,
    });
    res.status(data.duplicateRequest ? 200 : 201).json({ success: true, data });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

export default router;
