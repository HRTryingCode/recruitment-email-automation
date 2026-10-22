// F2: `integrations.lever` for GET /api/lookup (F1). Live, read-only Lever
// check so people the app has never seen still show their Lever status.
//
// F1 contract: absent when the integration is not configured; otherwise
// `{ status: 'FOUND' | 'NOT_FOUND' | 'ERROR', ... }` with display fields only;
// a failure reports ERROR and never fails the lookup.
import { LeverClient, type LeverOpportunity, type LeverState } from './lever.service';

export interface LeverLookupIntegration {
  status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  state: LeverState;
  message?: string;
  primary: LeverOpportunity | null;
  opportunities: LeverOpportunity[];
  opportunityCount: number;
  checkedAt: string;
}

type LeverLookup = Pick<LeverClient, 'configured' | 'findByEmail'>;

function errorResult(reason: string): LeverLookupIntegration {
  return {
    status: 'ERROR',
    state: 'ERROR',
    message: `Lever request failed (${reason})`,
    primary: null,
    opportunities: [],
    opportunityCount: 0,
    checkedAt: new Date().toISOString(),
  };
}

export async function leverLookupIntegration(
  email: string,
  // One retry only: a person is waiting on this response.
  client: LeverLookup = new LeverClient({ maxRetries: 1 }),
  opts: { timeoutMs?: number } = {}
): Promise<LeverLookupIntegration | undefined> {
  if (!client.configured) return undefined;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), opts.timeoutMs ?? 8_000);
  });
  try {
    const s = await Promise.race([client.findByEmail(email), timeout]);
    if (s === 'timeout') return errorResult('timeout');
    if (s.state === 'ERROR') return errorResult(s.reason ?? 'unknown');
    return {
      status: s.state === 'NOT_FOUND' ? 'NOT_FOUND' : 'FOUND',
      state: s.state,
      primary: s.primary,
      opportunities: s.opportunities,
      opportunityCount: s.opportunities.length,
      checkedAt: s.checkedAt,
    };
  } catch {
    return errorResult('unexpected');
  } finally {
    clearTimeout(timer);
  }
}
