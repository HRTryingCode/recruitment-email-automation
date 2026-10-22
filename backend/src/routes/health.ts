import { Router, Request, Response, NextFunction } from 'express';
import { checkHealth, collectHealthIssues } from '../services/monitoring.service';
import { safeError } from '../lib/safeError';

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

// GET /api/health/deep — public pipeline-health probe for an external uptime
// monitor (audit H3). Unlike `/`, it is "degraded" whenever ingestion is
// broken: a mailbox needs reconnect, a Gmail watch expired, a mailbox has
// not reconciled in 3h, the hourly reconcile stopped (dead-man's switch),
// reconcile keeps hitting its time budget, or webhook errors spike.
//
// Returns 503 for both degraded and unhealthy so plain HTTP-status monitors
// page on it. Like `/`, it is unauthenticated, so it exposes only issue
// counts by type — no mailbox addresses or ids. Results are cached for 60s
// per instance to blunt abuse (each evaluation scans SystemLog).
type DeepHealth = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  database: { connected: boolean };
  issues: Record<string, number>;
  checkedAt: string;
};
const DEEP_CACHE_MS = 60_000;
let deepCache: { at: number; value: DeepHealth } | null = null;

router.get('/deep', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    let value: DeepHealth;
    if (deepCache && Date.now() - deepCache.at < DEEP_CACHE_MS) {
      value = deepCache.value;
    } else {
      const base = await checkHealth();
      const issues: Record<string, number> = {};
      let issuesFailed = false;
      if (base.database.connected) {
        try {
          for (const issue of await collectHealthIssues()) {
            issues[issue.type] = (issues[issue.type] ?? 0) + 1;
          }
        } catch (err) {
          console.error('[health/deep] collectHealthIssues failed:', safeError(err));
          issuesFailed = true;
        }
      }
      const status: DeepHealth['status'] = !base.database.connected || issuesFailed
        ? 'unhealthy'
        : Object.keys(issues).length > 0
          ? 'degraded'
          : 'healthy';
      value = {
        status,
        database: { connected: base.database.connected },
        issues,
        checkedAt: new Date().toISOString(),
      };
      deepCache = { at: Date.now(), value };
    }
    res.status(value.status === 'healthy' ? 200 : 503).json({ success: true, data: value });
  } catch (err) {
    next(err);
  }
});

/** Test-only: clear the 60s deep-health cache. */
export function _resetDeepHealthCacheForTests(): void {
  deepCache = null;
}

export default router;
