import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import { getAuthUrl, handleCallback, watchMailbox } from '../services/gmail.service';
import { createError } from '../middleware/error';
import { logEvent } from '../services/monitoring.service';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

// GET /api/mailboxes
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mailboxes = await prisma.mailbox.findMany({
      select: {
        id: true,
        provider: true,
        emailAddress: true,
        displayName: true,
        isActive: true,
        watchExpiry: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { threads: true, messages: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: mailboxes });
  } catch (err) {
    next(err);
  }
});

// POST /api/mailboxes/gmail/auth
router.post('/gmail/auth', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const authUrl = getAuthUrl('new');
    res.json({ success: true, data: { authUrl } });
  } catch (err) {
    next(err);
  }
});

// GET /api/mailboxes/gmail/callback
router.get(
  '/gmail/callback',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = qs(req.query.code);
      const state = qs(req.query.state);

      if (!code) {
        return next(createError('Missing authorization code', 400));
      }

      const mailbox = await handleCallback(code, state);

      try {
        await watchMailbox(mailbox.id);
      } catch (watchErr) {
        console.warn('[Mailbox] Gmail watch setup failed:', watchErr);
      }

      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
      res.redirect(`${frontendUrl}?mailbox=connected`);
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/mailboxes/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const mailbox = await prisma.mailbox.findUnique({ where: { id } });
    if (!mailbox) {
      return next(createError('Mailbox not found', 404));
    }

    await prisma.mailbox.update({
      where: { id },
      data: { isActive: false },
    });

    await logEvent('MAILBOX_DISCONNECTED', { mailboxId: id }, 'INFO');
    res.json({ success: true, message: 'Mailbox disconnected' });
  } catch (err) {
    next(err);
  }
});

export default router;
