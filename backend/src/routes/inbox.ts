import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error';
import { INBOX_VIEWS, ROLE_UNKNOWN_PARAM, decodeCursor, getInbox } from '../services/inbox.service';

const router = Router();

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

/** Every value of a repeatable param (`?role=a&role=b`, or qs's `role[]=`). */
function qsAll(val: unknown): string[] {
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) return val.filter((v): v is string => typeof v === 'string');
  return [];
}

const inboxQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS, { errorMap: () => ({ message: `view must be one of ${INBOX_VIEWS.join(', ')}` }) }).default('needs_review'),
  mailboxId: z.string().regex(/^[a-z0-9]{20,30}$/, 'mailboxId must be a cuid').optional(),
  // newest = newest first; oldest = oldest-waiting first.
  order: z.enum(['newest', 'oldest'], { errorMap: () => ({ message: "order must be 'newest' or 'oldest'" }) }).default('newest'),
  cursor: z.string().max(500).optional(),
  // Repeatable, not comma-separated: role titles can contain commas.
  role: z.array(z.string().trim().min(1).max(200, 'role must be at most 200 characters')).max(50, 'too many role values'),
});

// GET /api/inbox?view=&mailboxId=&order=&cursor=&role=…&role=__none__
// The U0 review queue: one page of items for a view plus counts for every
// view. Polled by the UI (~15s); see inbox.service for the view rules.
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = inboxQuerySchema.safeParse({
      view: qs(req.query.view),
      mailboxId: qs(req.query.mailboxId),
      order: qs(req.query.order),
      cursor: qs(req.query.cursor),
      role: qsAll(req.query.role),
    });
    if (!parsed.success) return next(createError(parsed.error.errors[0]?.message ?? 'Invalid query', 400));
    const { cursor: rawCursor, role, ...q } = parsed.data;
    const roleFilter = role.length
      ? { roles: [...new Set(role.filter((r) => r !== ROLE_UNKNOWN_PARAM))], unknown: role.includes(ROLE_UNKNOWN_PARAM) }
      : null;
    const cursor = rawCursor ? decodeCursor(rawCursor) : null;
    if (rawCursor && !cursor) return next(createError('Invalid cursor', 400));

    const page = await getInbox({ ...q, cursor, roleFilter }, req.userId);
    res.json({ success: true, data: page });
  } catch (err) {
    next(err);
  }
});

export default router;
