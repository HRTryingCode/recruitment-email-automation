import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';
import { createDraft, sendDraft as gmailSendDraft } from '../services/gmail.service';
import { logEvent } from '../services/monitoring.service';
import { z } from 'zod';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

const updateDraftSchema = z.object({
  bodyText: z.string().optional(),
  bodyHtml: z.string().optional(),
  subject: z.string().optional(),
});

const draftWithThreadInclude = {
  thread: {
    include: {
      candidate: true,
      mailbox: true,
    },
  },
} as const;

// GET /api/drafts
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = qs(req.query.status);
    const page = parseInt(qs(req.query.page) ?? '1');
    const limit = parseInt(qs(req.query.limit) ?? '50');
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [drafts, total] = await Promise.all([
      prisma.emailDraft.findMany({
        where,
        include: {
          thread: {
            include: {
              candidate: {
                select: { id: true, name: true, email: true },
              },
              mailbox: {
                select: { id: true, emailAddress: true, provider: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.emailDraft.count({ where }),
    ]);

    res.json({ success: true, data: drafts, meta: { total, page, limit } });
  } catch (err) {
    next(err);
  }
});

// GET /api/drafts/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draft = await prisma.emailDraft.findUnique({
      where: { id },
      include: {
        thread: {
          include: {
            messages: { orderBy: { receivedAt: 'asc' } },
            candidate: true,
            mailbox: true,
          },
        },
      },
    });

    if (!draft) {
      return next(createError('Draft not found', 404));
    }

    res.json({ success: true, data: draft });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/drafts/:id
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(createError(parsed.error.message, 400));
    }

    const id = String(req.params.id);
    const draft = await prisma.emailDraft.findUnique({ where: { id } });
    if (!draft) return next(createError('Draft not found', 404));
    if (draft.status !== 'PENDING') {
      return next(createError('Can only edit pending drafts', 400));
    }

    const updated = await prisma.emailDraft.update({
      where: { id },
      data: parsed.data,
    });

    res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/approve
router.post('/:id/approve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draftWithThread = await prisma.emailDraft.findUnique({
      where: { id },
      include: draftWithThreadInclude,
    });

    if (!draftWithThread) return next(createError('Draft not found', 404));
    if (draftWithThread.status !== 'PENDING') {
      return next(createError('Draft is not in PENDING status', 400));
    }

    const thread = draftWithThread.thread;
    const mailbox = thread.mailbox;
    const candidate = thread.candidate;

    if (mailbox.provider === 'GMAIL' && candidate) {
      try {
        const externalDraftId = await createDraft(mailbox.id, {
          threadId: thread.id,
          externalThreadId: thread.externalThreadId,
          subject: draftWithThread.subject,
          bodyText: draftWithThread.bodyText,
          bodyHtml: draftWithThread.bodyHtml ?? undefined,
          inReplyToMessageId: draftWithThread.inReplyToMessageId ?? undefined,
          referencesHeader: draftWithThread.referencesHeader ?? undefined,
          toAddress: candidate.email,
        });

        await prisma.emailDraft.update({
          where: { id },
          data: { status: 'APPROVED', externalDraftId },
        });
      } catch (gmailErr) {
        console.error('[Drafts] Failed to create Gmail draft:', gmailErr);
        await prisma.emailDraft.update({
          where: { id },
          data: { status: 'APPROVED' },
        });
      }
    } else {
      await prisma.emailDraft.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
    }

    await logEvent('DRAFT_APPROVED', { draftId: id }, 'INFO');
    res.json({ success: true, message: 'Draft approved' });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/discard
router.post('/:id/discard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draft = await prisma.emailDraft.findUnique({ where: { id } });
    if (!draft) return next(createError('Draft not found', 404));
    if (draft.status === 'SENT') {
      return next(createError('Cannot discard a sent draft', 400));
    }

    await prisma.emailDraft.update({
      where: { id },
      data: { status: 'DISCARDED' },
    });

    await logEvent('DRAFT_DISCARDED', { draftId: id }, 'INFO');
    res.json({ success: true, message: 'Draft discarded' });
  } catch (err) {
    next(err);
  }
});

// POST /api/drafts/:id/send
router.post('/:id/send', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const draftWithThread = await prisma.emailDraft.findUnique({
      where: { id },
      include: draftWithThreadInclude,
    });

    if (!draftWithThread) return next(createError('Draft not found', 404));
    if (draftWithThread.status !== 'APPROVED') {
      return next(createError('Draft must be approved before sending', 400));
    }

    const thread = draftWithThread.thread;
    const mailbox = thread.mailbox;
    const candidate = thread.candidate;

    if (draftWithThread.externalDraftId && mailbox.provider === 'GMAIL') {
      await gmailSendDraft(mailbox.id, draftWithThread.externalDraftId);
    } else if (mailbox.provider === 'GMAIL' && candidate) {
      const externalDraftId = await createDraft(mailbox.id, {
        threadId: thread.id,
        externalThreadId: thread.externalThreadId,
        subject: draftWithThread.subject,
        bodyText: draftWithThread.bodyText,
        bodyHtml: draftWithThread.bodyHtml ?? undefined,
        inReplyToMessageId: draftWithThread.inReplyToMessageId ?? undefined,
        referencesHeader: draftWithThread.referencesHeader ?? undefined,
        toAddress: candidate.email,
      });
      await gmailSendDraft(mailbox.id, externalDraftId);
    }

    await prisma.emailDraft.update({
      where: { id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    if (candidate) {
      await prisma.candidate.update({
        where: { id: candidate.id },
        data: { status: 'REPLIED' },
      });
    }

    await logEvent('DRAFT_SENT', { draftId: id }, 'INFO');
    res.json({ success: true, message: 'Draft sent' });
  } catch (err) {
    next(err);
  }
});

export default router;
