import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { serializeEmailMessages } from '../lib/emailMessageSerializer';
import { z } from 'zod';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

// Cuid pattern shared with the candidates list — keeps the two routes in sync
// about what shape a mailbox/candidate id is allowed to take from the wire.
const cuidPattern = /^[a-z0-9]{20,30}$/;
const threadListFilterSchema = z.object({
  mailboxId: z.string().regex(cuidPattern, 'mailboxId must be a cuid').optional(),
  candidateId: z
    .string()
    .regex(cuidPattern, 'candidateId must be a cuid')
    .optional(),
});

// GET /api/emails/threads
router.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const filterParsed = threadListFilterSchema.safeParse({
      mailboxId: qs(req.query.mailboxId),
      candidateId: qs(req.query.candidateId),
    });
    if (!filterParsed.success) {
      return next(createError(filterParsed.error.errors[0]?.message ?? 'Invalid filter', 400));
    }
    const { mailboxId, candidateId } = filterParsed.data;
    const paged = paginationSchema.safeParse({
      page: qs(req.query.page),
      limit: qs(req.query.limit),
    });
    if (!paged.success) {
      return next(createError(paged.error.message, 400));
    }
    const { page, limit } = paged.data;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (mailboxId) where.mailboxId = mailboxId;
    if (candidateId) where.candidateId = candidateId;

    const [threads, total] = await Promise.all([
      prisma.emailThread.findMany({
        where,
        include: {
          candidate: {
            select: { id: true, name: true, email: true, status: true, role: true },
          },
          mailbox: {
            select: { id: true, emailAddress: true, provider: true },
          },
          _count: { select: { messages: true, drafts: true } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailThread.count({ where }),
    ]);

    res.json({ success: true, data: threads, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /api/emails/threads/:id/messages
router.get(
  '/threads/:id/messages',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = String(req.params.id);
      const thread = await prisma.emailThread.findUnique({
        where: { id },
        include: {
          messages: { orderBy: { receivedAt: 'asc' } },
          drafts: { orderBy: { createdAt: 'desc' } },
          candidate: {
            select: { id: true, name: true, email: true, status: true, role: true },
          },
          mailbox: {
            select: { id: true, emailAddress: true, provider: true },
          },
        },
      });

      if (!thread) {
        return next(createError('Thread not found', 404));
      }

      const data = {
        ...thread,
        messages: serializeEmailMessages(thread.messages),
      };
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
