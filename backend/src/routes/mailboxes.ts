import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';
import {
  getAuthUrl,
  createServiceAccountClient,
  serializeCredentials,
} from '../services/gmail.service';
import { createError } from '../middleware/error';
import { logEvent } from '../services/monitoring.service';

const router = Router();

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

// NOTE: GET /api/mailboxes/gmail/callback is registered directly on the
// Express app (see app.ts) because Google's OAuth redirect cannot carry a JWT.
// Keeping it out of this router avoids accidentally putting it behind
// requireAuth.

// POST /api/mailboxes/workspace/connect
router.post('/workspace/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { emailAddresses } = req.body as { emailAddresses?: string[] };
    if (!Array.isArray(emailAddresses) || emailAddresses.length === 0) {
      return next(createError('emailAddresses must be a non-empty array', 400));
    }

    const results: Array<{ email: string; success: boolean; error?: string }> = [];

    for (const email of emailAddresses) {
      try {
        // Validate by trying to list 1 message via service account
        const gmail = await createServiceAccountClient(email);
        await gmail.users.messages.list({ userId: email, maxResults: 1 });

        const encryptedCreds = serializeCredentials({
          type: 'service_account',
          impersonating: email,
        });
        const mailbox = await prisma.mailbox.upsert({
          where: { emailAddress: email },
          update: {
            provider: 'GMAIL',
            credentials: encryptedCreds,
            isActive: true,
            updatedAt: new Date(),
          },
          create: {
            provider: 'GMAIL',
            emailAddress: email,
            displayName: email,
            credentials: encryptedCreds,
            isActive: true,
          },
        });

        await logEvent('MAILBOX_WORKSPACE_CONNECTED', { mailboxId: mailbox.id, email }, 'INFO');
        results.push({ email, success: true });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ email, success: false, error: message });
      }
    }

    res.json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

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
