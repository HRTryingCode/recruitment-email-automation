import { Router, Request, Response, NextFunction } from 'express';
import { checkHealth } from '../services/monitoring.service';

const router = Router();

// GET /api/health — public liveness probe.
//
// The endpoint is mounted before requireAuth (see app.ts) so Vercel cron,
// uptime monitors, and the platform load balancer can hit it without a JWT.
// Because it's unauthenticated, the response is reduced to the minimum
// signal needed for that audience: an overall status string plus the two
// dependency liveness booleans. We deliberately drop:
//
//   - `mailboxes[].emailAddress` — leaks recruiter PII and lets an
//     attacker enumerate every connected Gmail account.
//   - `database.latencyMs`        — minor timing-side-channel.
//   - `recentLogs[].details`      — full Prisma / handler error strings
//     that disclose the Supabase pooler hostname, schema, and stack
//     frames. The dashboard's mailbox-health tile fetches the rich
//     payload from `/api/internal/sync-health` (requireAuth-gated).
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await checkHealth();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json({
      success: true,
      data: {
        status: health.status,
        database: { connected: health.database.connected },
        claude: { available: health.claude.available },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
