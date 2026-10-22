// Near-real-time Lever status (H2). Two event sources replace faster polling:
//   - our own writes: a new Candidate (or a changed email) is checked against
//     Lever in the background right away (scheduleLeverRefresh);
//   - Lever's writes: Lever webhooks (routes/webhooks-lever.ts) name an
//     opportunity, and every matching Candidate is re-read from Lever.
// The 3h lever-sync and 15-min lever-sync-new crons remain the safety net.
// Read-only against Lever: every refresh goes through refreshCandidateLever.
import { waitUntil } from '@vercel/functions';
import { LeverClient } from './lever.service';
import { refreshCandidateLever } from './leverSync.service';
import { logEvent } from './monitoring.service';

type LeverLookup = Pick<LeverClient, 'configured' | 'findByEmail'>;

export type LeverRefreshReason = 'created' | 'email_changed';

/**
 * Refreshes one candidate's Lever columns without blocking the caller.
 * Errors are swallowed (logged as LEVER_REFRESH_FAILED); the crons retry.
 * No-op when LEVER_API_KEY is unset, so fresh rows stay "Checking Lever…"
 * rather than getting an `unconfigured` ERROR.
 */
export function scheduleLeverRefresh(
  candidateId: string,
  reason: LeverRefreshReason,
  deps: { client?: LeverLookup; refresh?: typeof refreshCandidateLever } = {}
): void {
  const client = deps.client ?? new LeverClient();
  if (!client.configured) return;
  const refresh = deps.refresh ?? refreshCandidateLever;
  const work = Promise.resolve()
    .then(() => refresh(candidateId, client))
    .then(
      () => undefined,
      async (err: unknown) => {
        await logEvent(
          'LEVER_REFRESH_FAILED',
          { candidateId, reason, error: err instanceof Error ? err.message : String(err) },
          'WARN'
        );
      }
    );
  waitUntil(work);
}
