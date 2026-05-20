import { Router, Request, Response, NextFunction } from 'express';
import { checkHealth } from '../services/monitoring.service';

const router = Router();

// GET /api/health
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await checkHealth();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

export default router;
