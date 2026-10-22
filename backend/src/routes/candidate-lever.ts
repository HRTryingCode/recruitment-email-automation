// F2/F3: Lever actions for one candidate. Mounted under /api/candidates
// behind requireAuth (app.ts). F2's refresh is read-only; F3's create is the
// app's only Lever write and sits behind LEVER_CREATE_ENABLED.
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { createError } from '../middleware/error';
import { refreshCandidateLever } from '../services/leverSync.service';
import {
  buildGemPrefill,
  buildPrefill,
  createInLever,
  createRequestSchema,
  findCandidateForPrefill,
  isLeverCreateEnabled,
  prefillServerTiming,
  toHttpError,
} from '../services/addToLever.service';

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

// GET /api/candidates/:id/lever/prefill — proposed Add to Lever payload,
// app data only (H5: the dialog opens on this; Gem arrives separately).
router.get('/:id/lever/prefill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const t0 = Date.now();
    const id = cuidSchema.safeParse(req.params.id);
    if (!id.success) return next(createError('Invalid candidate id', 400));
    const candidate = await findCandidateForPrefill({ id: id.data });
    if (!candidate) return next(createError('Candidate not found', 404));
    const lookupMs = Date.now() - t0;
    const { prefill, timings } = await buildPrefill({ actorUserId: req.userId!, email: candidate.email, candidate });
    const t = { ...timings, dbMs: timings.dbMs + lookupMs, totalMs: Date.now() - t0 };
    console.info('[AddToLever] prefill timings', t);
    res.setHeader('Server-Timing', prefillServerTiming(t));
    res.json({ success: true, data: prefill });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

// GET /api/candidates/:id/lever/prefill/gem — Gem enrichment for the dialog
// (cached on the candidate; live on a miss).
router.get('/:id/lever/prefill/gem', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = cuidSchema.safeParse(req.params.id);
    if (!id.success) return next(createError('Invalid candidate id', 400));
    const candidate = await findCandidateForPrefill({ id: id.data });
    if (!candidate) return next(createError('Candidate not found', 404));
    const data = await buildGemPrefill({ actorUserId: req.userId!, email: candidate.email, candidate });
    res.json({ success: true, data });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

// POST /api/candidates/:id/lever — create the opportunity (confirmed payload).
router.post('/:id/lever', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!isLeverCreateEnabled()) return next(createError('Add to Lever is turned off', 403));
    const id = cuidSchema.safeParse(req.params.id);
    if (!id.success) return next(createError('Invalid candidate id', 400));
    const body = createRequestSchema.safeParse(req.body);
    if (!body.success) return next(createError(body.error.issues[0]?.message ?? 'Invalid request', 400));
    const candidate = await findCandidateForPrefill({ id: id.data });
    if (!candidate) return next(createError('Candidate not found', 404));
    const data = await createInLever({
      actorUserId: req.userId!,
      email: candidate.email,
      candidateId: candidate.id,
      gemPersonId: candidate.gemPersonId ?? null,
      req: body.data,
    });
    res.status(data.duplicateRequest ? 200 : 201).json({ success: true, data });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

export default router;
