// F2: on-demand Lever status refresh for one candidate. Mounted under
// /api/candidates behind requireAuth (app.ts). Read-only against Lever.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error';
import { refreshCandidateLever } from '../services/leverSync.service';

const router = Router();

const cuidSchema = z.string().regex(/^[a-z0-9]{20,30}$/, 'id must be a cuid');

// POST /api/candidates/:id/lever/refresh
router.post('/:id/lever/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = cuidSchema.safeParse(req.params.id);
    if (!id.success) return next(createError('Invalid candidate id', 400));
    const out = await refreshCandidateLever(id.data);
    if (!out) return next(createError('Candidate not found', 404));
    res.json({ success: true, data: { candidate: out.candidate, lever: out.status } });
  } catch (err) {
    next(err);
  }
});

export default router;
