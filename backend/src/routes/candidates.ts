import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { logEvent } from '../services/monitoring.service';
import { serializeEmailMessages } from '../lib/emailMessageSerializer';
import { classifyReply } from '../services/claude.service';
import { requireAdmin } from '../middleware/requireAdmin';
import { z } from 'zod';

const router = Router();

const CANDIDATE_STATUSES = [
  'PENDING',
  'INTERESTED',
  'NOT_INTERESTED',
  'NEUTRAL',
  'REPLIED',
  'NEEDS_REVIEW',
  'IGNORED',
] as const;

const updateCandidateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  status: z.enum(CANDIDATE_STATUSES).optional(),
  notes: z.string().optional(),
});

// Pagination bounds — clamp `page` and `limit` so an attacker (or a buggy
// caller) can't force the server to skip past unbounded offsets or pull
// massive result sets per request.
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// Validate filter query params before they hit Prisma. Without this the
// `status` / `mailboxId` strings flow straight into the where clause; the
// runtime still rejects malformed inputs at the DB layer, but the response
// is opaque and the SQL it generates is wasted work.
const candidateListFilterSchema = z.object({
  status: z.enum(CANDIDATE_STATUSES).optional(),
  // Cuid shape — 20–30 lowercase alphanumerics. Prisma's default id() uses
  // `c` + 24 chars in practice; the wider range absorbs other cuid variants
  // without opening up to arbitrary input.
  mailboxId: z
    .string()
    .regex(/^[a-z0-9]{20,30}$/, 'mailboxId must be a cuid')
    .optional(),
});

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

type ReplyStatus = 'NEW' | 'AWAITING_REPLY' | 'REPLIED';

function deriveReplyStatus(c: {
  repliedAt: Date | null;
  threads: Array<{ lastMessageAt: Date }>;
}): ReplyStatus {
  if (c.repliedAt) return 'REPLIED';
  if (!c.threads.length) return 'NEW';
  return 'AWAITING_REPLY';
}

// GET /api/candidates
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filterParsed = candidateListFilterSchema.safeParse({
      status: qs(req.query.status),
      mailboxId: qs(req.query.mailboxId),
    });
    if (!filterParsed.success) {
      return next(createError(filterParsed.error.errors[0]?.message ?? 'Invalid filter', 400));
    }
    const { status, mailboxId } = filterParsed.data;
    const paged = paginationSchema.safeParse({
      page: qs(req.query.page),
      limit: qs(req.query.limit),
    });
    if (!paged.success) {
      return next(createError(paged.error.message, 400));
    }
    const { page, limit } = paged.data;
    const skip = (page - 1) * limit;

    const includeIgnored = qs(req.query.includeIgnored) === 'true';

    const where: Record<string, unknown> = {};
    if (status) {
      where.status = status;
    } else if (!includeIgnored) {
      // Default view hides ignored candidates so dismissed people don't clutter
      // the dashboard. Caller can pass ?status=IGNORED or ?includeIgnored=true
      // to see them.
      where.status = { not: 'IGNORED' };
    }
    if (mailboxId) where.mailboxId = mailboxId;

    const [candidates, total] = await Promise.all([
      prisma.candidate.findMany({
        where,
        include: {
          mailbox: {
            select: { id: true, emailAddress: true, provider: true },
          },
          threads: {
            orderBy: { lastMessageAt: 'desc' },
            take: 1,
            select: { id: true, subject: true, lastMessageAt: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.candidate.count({ where }),
    ]);

    const enriched = candidates.map((c) => ({
      ...c,
      replyStatus: deriveReplyStatus(c),
    }));

    res.json({ success: true, data: enriched, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /api/candidates/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: {
        mailbox: {
          select: { id: true, emailAddress: true, provider: true },
        },
        threads: {
          orderBy: { lastMessageAt: 'desc' },
          include: {
            messages: { orderBy: { receivedAt: 'asc' } },
            drafts: { orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });

    if (!candidate) {
      return next(createError('Candidate not found', 404));
    }

    const data = {
      ...candidate,
      threads: candidate.threads.map((t) => ({
        ...t,
        messages: serializeEmailMessages(t.messages),
      })),
    };
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/candidates/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateCandidateSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400));
    }

    const id = String(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) {
      return next(createError('Candidate not found', 404));
    }

    // Guard against email collisions explicitly so the caller gets a 409 with
    // a clear message instead of Prisma's opaque P2002 surfacing as a 500.
    if (parsed.data.email && parsed.data.email !== candidate.email) {
      const existing = await prisma.candidate.findUnique({
        where: { email: parsed.data.email },
      });
      if (existing && existing.id !== id) {
        return next(
          createError('Another candidate already uses this email', 409)
        );
      }
    }

    const updated = await prisma.candidate.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/candidates/:id/ignore
// Dismiss a candidate from the dashboard. Sets status=IGNORED and atomically
// discards every live (PENDING/APPROVED) draft on the candidate's threads so
// dismissed people stop showing up in the drafts queue.
router.post('/:id/ignore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const candidate = await prisma.candidate.findUnique({
      where: { id },
      include: { threads: { select: { id: true } } },
    });
    if (!candidate) {
      return next(createError('Candidate not found', 404));
    }

    const threadIds = candidate.threads.map((t) => t.id);

    const [updated, discardResult] = await prisma.$transaction([
      prisma.candidate.update({
        where: { id },
        data: { status: 'IGNORED' },
      }),
      prisma.emailDraft.updateMany({
        where: {
          threadId: { in: threadIds },
          status: { in: ['PENDING', 'APPROVED'] },
        },
        data: { status: 'DISCARDED' },
      }),
    ]);

    await logEvent(
      'CANDIDATE_IGNORED',
      {
        candidateId: id,
        draftsDiscarded: discardResult.count,
      },
      'INFO'
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/candidates/:id/unignore
// Manual undo. We lose the original classification — acceptable since this is
// a deliberate recruiter action. Reverts to NEUTRAL; the next inbound message
// will re-classify if applicable. Does NOT regenerate drafts.
router.post('/:id/unignore', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const candidate = await prisma.candidate.findUnique({ where: { id } });
    if (!candidate) {
      return next(createError('Candidate not found', 404));
    }

    const updated = await prisma.candidate.update({
      where: { id },
      data: { status: 'NEUTRAL' },
    });

    await logEvent(
      'CANDIDATE_UNIGNORED',
      { candidateId: id },
      'INFO'
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/candidates/backfill-roles
// One-shot admin action: re-classify every candidate that has role=null
// and surface the role to the Candidate row. Useful right after the Phase
// AN deploy when existing NEUTRAL/NOT_INTERESTED candidates never got
// role extracted (regenerate-pending only covers PENDING drafts).
//
// Caps at 25 per request to fit inside Vercel's function timeout — call
// repeatedly until { remaining: 0 }.
router.post('/backfill-roles', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const targets = await prisma.candidate.findMany({
      where: { role: null },
      include: {
        threads: {
          include: {
            mailbox: { select: { emailAddress: true } },
            messages: {
              orderBy: { receivedAt: 'desc' },
              take: 8,
            },
          },
          orderBy: { lastMessageAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'asc' },
      take: 25,
    });

    let updated = 0;
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const c of targets) {
      const thread = c.threads[0];
      if (!thread) {
        skipped.push({ id: c.id, reason: 'no_thread' });
        continue;
      }
      const mailboxAddr = thread.mailbox?.emailAddress?.toLowerCase() ?? '';
      // Most recent inbound message (not sent from the recruiter mailbox).
      const inbound = thread.messages.find(
        (m) => m.fromAddress.toLowerCase() !== mailboxAddr
      );
      if (!inbound) {
        skipped.push({ id: c.id, reason: 'no_inbound_message' });
        continue;
      }
      const previousMessages = thread.messages
        .filter((m) => m.receivedAt.getTime() < inbound.receivedAt.getTime())
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())
        .map((m) => ({
          fromAddress: m.fromAddress,
          fromName: m.fromName,
          bodyText: m.bodyText,
          receivedAt: m.receivedAt,
        }));

      try {
        const result = await classifyReply(
          inbound.bodyText || inbound.bodyHtml || inbound.subject,
          inbound.fromName ?? c.name,
          { subject: thread.subject, previousMessages }
        );
        if (result.role) {
          await prisma.candidate.update({
            where: { id: c.id },
            data: { role: result.role },
          });
          await logEvent(
            'CANDIDATE_ROLE_DETECTED',
            { candidateId: c.id, role: result.role, via: 'backfill' },
            'INFO'
          );
          updated += 1;
        } else {
          skipped.push({ id: c.id, reason: 'no_role_in_classifier_output' });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        skipped.push({ id: c.id, reason: `classify_failed: ${msg}` });
      }
    }

    const remaining = await prisma.candidate.count({ where: { role: null } });
    res.json({
      success: true,
      processed: targets.length,
      updated,
      skipped,
      remaining,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
