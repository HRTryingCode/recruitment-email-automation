// F3: per-user Gem (GeMCP) connection. Mounted at /api/integrations behind
// requireAuth (app.ts). The OAuth callback is registered directly on the app
// because Gem's redirect can't carry our JWT; it is bound to the user by the
// one-time `gem-` OAuth state row (lib/oauthState.ts).
import { Router, Request, Response, NextFunction } from 'express';
import { createError } from '../middleware/error';
import { safeError } from '../lib/safeError';
import { buildGemAuthUrl, gemConnectionStatus, disconnectGem } from '../services/gem.service';

const router = Router();

// GET /api/integrations/gem/connect
// Returns Gem's authorize URL; the SPA navigates to it (the JWT lives in
// localStorage, so a top-level browser GET couldn't authenticate here).
router.get('/gem/connect', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) return next(createError('Unauthenticated', 401));
    let authUrl: string;
    try {
      authUrl = await buildGemAuthUrl(req.userId);
    } catch (err) {
      console.warn('[Gem] connect failed:', safeError(err).message);
      return next(createError('Could not reach Gem to start the connection. Try again later.', 502));
    }
    res.json({ success: true, data: { authUrl } });
  } catch (err) {
    next(err);
  }
});

// GET /api/integrations/gem/status
router.get('/gem/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) return next(createError('Unauthenticated', 401));
    res.json({ success: true, data: await gemConnectionStatus(req.userId) });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/integrations/gem — forget the caller's Gem tokens.
router.delete('/gem', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.userId) return next(createError('Unauthenticated', 401));
    await disconnectGem(req.userId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
