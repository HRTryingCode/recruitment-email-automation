import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { z } from 'zod';

const router = Router();

const updateCandidateSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  status: z
    .enum(['PENDING', 'INTERESTED', 'NOT_INTERESTED', 'NEUTRAL', 'REPLIED'])
    .optional(),
  notes: z.string().optional(),
});

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

// GET /api/candidates
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = qs(req.query.status);
    const mailboxId = qs(req.query.mailboxId);
    const page = parseInt(qs(req.query.page) ?? '1');
    const limit = parseInt(qs(req.query.limit) ?? '50');
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
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

    res.json({ success: true, data: candidates, meta: { total, page, limit } });
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

    res.json({ success: true, data: candidate });
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

    const updated = await prisma.candidate.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
