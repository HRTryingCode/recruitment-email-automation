import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error';
import { INBOX_VIEWS, decodeCursor, getInbox } from '../services/inbox.service';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

const inboxQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS, { errorMap: () => ({ message: `view must be one of ${INBOX_VIEWS.join(', ')}` }) }).default('needs_review'),
  mailboxId: z.string().regex(/^[a-z0-9]{20,30}$/, 'mailboxId must be a cuid').optional(),
  // newest = newest first; oldest = oldest-waiting first.
  order: z.enum(['newest', 'oldest'], { errorMap: () => ({ message: "order must be 'newest' or 'oldest'" }) }).default('newest'),
  cursor: z.string().max(500).optional(),
});

// GET /api/inbox?view=&mailboxId=&order=&cursor=
// The U0 review queue: one page of items for a view plus counts for every
// view. Polled by the UI (~15s); see inbox.service for the view rules.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = inboxQuerySchema.safeParse({
      view: qs(req.query.view),
      mailboxId: qs(req.query.mailboxId),
      order: qs(req.query.order),
      cursor: qs(req.query.cursor),
    });
    if (!parsed.success) return next(createError(parsed.error.errors[0]?.message ?? 'Invalid query', 400));
    const { cursor: rawCursor, ...q } = parsed.data;
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) return next(createError('Invalid cursor', 400));

    const page = await getInbox({ ...q, cursor }, req.userId);
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

export default router;
