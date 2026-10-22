import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error';
import { getTodaySummary } from '../services/today.service';

const router = Router();

const todayQuerySchema = z.object({
  mailboxId: z.string().regex(/^[a-z0-9]{20,30}$/, 'mailboxId must be a cuid').optional(),
});

// GET /api/today?mailboxId=
// R4 Today page: waiting per Inbox view, sent today, per-mailbox activity,
// Lever snapshot and a 14-day series. Read-only; see today.service.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const raw = req.query.mailboxId;
    const parsed = todayQuerySchema.safeParse({ mailboxId: typeof raw === 'string' ? raw : undefined });
    if (!parsed.success) return next(createError(parsed.error.errors[0]?.message ?? 'Invalid query', 400));
    res.json({ success: true, data: await getTodaySummary(parsed.data) });
  } catch (err) {
    next(err);
  }
});

export default router;
