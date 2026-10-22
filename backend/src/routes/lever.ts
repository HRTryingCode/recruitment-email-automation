// F3: Lever reference data for the Add to Lever dialog. Mounted at
// /api/lever behind requireAuth (app.ts).
import { Router, Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/error';
import { getOpenPostings, getStages, defaultStage, leverMe, toHttpError } from '../services/addToLever.service';

const router = Router();

// GET /api/lever/postings — open jobs (published + internal), cached 10 min,
// plus stages and the default "Interest Call" stage id.
router.get('/postings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [postings, stages] = await Promise.all([getOpenPostings(), getStages()]);
    res.json({ success: true, data: { postings, stages, defaultStageId: defaultStage(stages)?.id ?? null } });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

// GET /api/lever/me — can the caller add to Lever? (flag + their Lever user)
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) return next(createError('Unauthenticated', 401));
    res.json({ success: true, data: await leverMe(req.userId) });
  } catch (err) {
    const mapped = toHttpError(err);
    if (mapped) return res.status(mapped.status).json(mapped.body);
    next(err);
  }
});

export default router;
