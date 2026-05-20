import { Router, Request, Response, NextFunction } from 'express';
import { renewGmailWatches } from '../services/gmail.service';

const router = Router();

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // Accept either an `Authorization: Bearer <CRON_SECRET>` header (our docs)
  // or Vercel's own `x-vercel-cron-signature` if it equals the secret.
  const header = req.headers.authorization;
  if (header && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim() === secret;
  }

  const vercelHeader = req.headers['x-vercel-cron-signature'];
  if (typeof vercelHeader === 'string' && vercelHeader === secret) {
    return true;
  }

  return false;
}

// POST /api/internal/cron/renew-watches
router.post(
  '/renew-watches',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAuthorized(req)) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      const renewed = await renewGmailWatches();
      res.status(200).json({ success: true, data: { renewed } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
