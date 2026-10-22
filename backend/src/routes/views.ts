// Saved views (U0): named filter sets for the Candidates page (R3) and the
// inbox. userId = owner; userId NULL = team-shared, which only admins may
// create, edit or delete. Someone else's private view reads as not found.
import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db/client';
import { createError } from '../middleware/error';

const router = Router();

export const SAVED_VIEW_SCOPES = ['candidates', 'inbox'] as const;
const MAX_FILTERS_BYTES = 10_000;

function qs(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0] as string;
  return undefined;
}

const filtersSchema = z
  .record(z.unknown())
  .refine((f) => JSON.stringify(f).length <= MAX_FILTERS_BYTES, `filters must be under ${MAX_FILTERS_BYTES} bytes`);
const nameSchema = z.string().trim().min(1, 'name is required').max(80);

const createSchema = z.object({
  name: nameSchema,
  scope: z.enum(SAVED_VIEW_SCOPES),
  filters: filtersSchema,
  shared: z.boolean().optional(),
});
const updateSchema = z.object({ name: nameSchema.optional(), filters: filtersSchema.optional() });

async function isAdmin(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === 'admin';
}

/** The view if the caller may change it; otherwise forwards 404/403 and returns null. */
async function loadEditable(req: Request, next: NextFunction) {
  const view = await prisma.savedView.findUnique({ where: { id: String(req.params.id) } });
  if (!view || (view.userId !== null && view.userId !== req.userId)) {
    next(createError('View not found', 404));
    return null;
  }
  if (view.userId === null && !(await isAdmin(req.userId))) {
    next(createError('Only admins can change team views', 403));
    return null;
  }
  return view;
}

// GET /api/views?scope=
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = qs(req.query.scope);
    if (scope !== undefined && !(SAVED_VIEW_SCOPES as readonly string[]).includes(scope)) {
      return next(createError(`scope must be one of ${SAVED_VIEW_SCOPES.join(', ')}`, 400));
    }
    const views = await prisma.savedView.findMany({
      where: { ...(scope ? { scope } : {}), OR: [{ userId: req.userId }, { userId: null }] },
      orderBy: [{ userId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    res.json({ success: true, data: views.map((v) => ({ ...v, shared: v.userId === null })) });
  } catch (err) {
    next(err);
  }
});

// POST /api/views  { name, scope, filters, shared? }
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(createError(parsed.error.errors[0]?.message ?? 'Invalid body', 400));
    const { shared, filters, ...rest } = parsed.data;
    if (shared && !(await isAdmin(req.userId))) {
      return next(createError('Only admins can create team views', 403));
    }
    const view = await prisma.savedView.create({
      data: { userId: shared ? null : (req.userId ?? null), ...rest, filters: filters as Prisma.InputJsonObject },
    });
    res.status(201).json({ success: true, data: { ...view, shared: view.userId === null } });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/views/:id  { name?, filters? }
router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return next(createError(parsed.error.errors[0]?.message ?? 'Invalid body', 400));
    const view = await loadEditable(req, next);
    if (!view) return;
    const { filters, ...rest } = parsed.data;
    const updated = await prisma.savedView.update({
      where: { id: view.id },
      data: { ...rest, ...(filters ? { filters: filters as Prisma.InputJsonObject } : {}) },
    });
    res.json({ success: true, data: { ...updated, shared: updated.userId === null } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/views/:id
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const view = await loadEditable(req, next);
    if (!view) return;
    await prisma.savedView.delete({ where: { id: view.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
