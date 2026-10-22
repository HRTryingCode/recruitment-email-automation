// Read-only Lever client (F2). GET requests only — this batch must never
// create or modify anything in Lever.
//
// Auth: `Authorization: Bearer <LEVER_API_KEY>` against https://api.lever.co/v1.
// Lever allows ~10 req/s (bursts of 20), so every request goes through a
// shared token bucket capped at 8 req/s, and 429/5xx are retried with
// backoff (Retry-After when Lever sends it).
//
// findByEmail never throws: missing key, timeouts and HTTP errors come back
// as state 'ERROR' with a short machine-readable `reason`.

export const LEVER_API_BASE = 'https://api.lever.co/v1';

export type LeverState = 'ACTIVE' | 'ARCHIVED' | 'HIRED' | 'NOT_FOUND' | 'ERROR';

export interface LeverOpportunity {
  id: string;
  postingTitle: string | null;
  stage: string | null;
  archived: boolean;
  hired: boolean;
  archivedReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  leverUrl: string;
}

export interface LeverStatus {
  state: LeverState;
  /** Set when state is 'ERROR': 'unconfigured' | 'timeout' | 'network' | 'http_<status>' | 'bad_response'. */
  reason?: string;
  primary: LeverOpportunity | null;
  opportunities: LeverOpportunity[];
  checkedAt: string;
}

export function leverOpportunityUrl(opportunityId: string): string {
  return `https://hire.lever.co/candidates/${encodeURIComponent(opportunityId)}`;
}

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Token bucket: `capacity` burst, refilled at `ratePerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly ratePerSec: number,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleep = realSleep
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    }
  }
}

// Module-wide so concurrent lookups in one function instance share the budget.
const sharedBucket = new TokenBucket(8, 8);

class LeverError extends Error {
  constructor(readonly reason: string) {
    super(`Lever request failed: ${reason}`);
  }
}

export interface LeverClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  rateLimiter?: { take(): Promise<void> };
  timeoutMs?: number;
  maxRetries?: number;
}

interface RawOpportunity {
  id: string;
  stage?: { text?: string } | string | null;
  archived?: { reason?: string | null; archivedAt?: number | null } | null;
  applications?: Array<{ posting?: string | null } | string> | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

function iso(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Most recently updated active opportunity, else most recently updated archived one. */
export function pickPrimary(opps: LeverOpportunity[]): LeverOpportunity | null {
  const byUpdatedDesc = (a: LeverOpportunity, b: LeverOpportunity) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  const active = opps.filter((o) => !o.archived).sort(byUpdatedDesc);
  if (active.length > 0) return active[0]!;
  const archived = opps.filter((o) => o.archived).sort(byUpdatedDesc);
  return archived[0] ?? null;
}

/**
 * One client per invocation (cron run, lookup request): posting titles and
 * archive reasons are cached on the instance.
 */
export class LeverClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly limiter: { take(): Promise<void> };
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly postingTitles = new Map<string, Promise<string | null>>();
  private archiveReasons: Promise<Map<string, { text: string; hired: boolean }>> | null = null;

  constructor(opts: LeverClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.LEVER_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.limiter = opts.rateLimiter ?? sharedBucket;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 3;
  }

  get configured(): boolean {
    return this.apiKey.trim() !== '';
  }

  private async get<T>(path: string, params: Array<[string, string]> = []): Promise<T> {
    const url = new URL(LEVER_API_BASE + path);
    for (const [k, v] of params) url.searchParams.append(k, v);

    for (let attempt = 0; ; attempt++) {
      await this.limiter.take();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
          signal: controller.signal,
        });
      } catch (err) {
        const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : 'network';
        if (attempt < this.maxRetries) {
          await this.sleep(this.backoffMs(attempt));
          continue;
        }
        throw new LeverError(reason);
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new LeverError('bad_response');
        }
      }
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(this.backoffMs(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw new LeverError(`http_${res.status}`);
    }
  }

  private backoffMs(attempt: number, retryAfter?: string | null): number {
    const secs = retryAfter ? Number(retryAfter) : NaN;
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs, 30) * 1000;
    return Math.min(500 * 2 ** attempt, 8000);
  }

  private postingTitle(postingId: string): Promise<string | null> {
    let p = this.postingTitles.get(postingId);
    if (!p) {
      p = this.get<{ data?: { text?: string } }>(`/postings/${encodeURIComponent(postingId)}`)
        .then((r) => r.data?.text ?? null)
        .catch(() => null);
      this.postingTitles.set(postingId, p);
    }
    return p;
  }

  private reasons(): Promise<Map<string, { text: string; hired: boolean }>> {
    if (!this.archiveReasons) {
      this.archiveReasons = this.get<{ data?: Array<{ id: string; text?: string; type?: string }> }>(
        '/archive_reasons'
      )
        .then((r) => new Map((r.data ?? []).map((x) => [x.id, { text: x.text ?? x.id, hired: x.type === 'hired' }])))
        .catch(() => new Map());
    }
    return this.archiveReasons;
  }

  private async listOpportunities(email: string): Promise<RawOpportunity[]> {
    const out: RawOpportunity[] = [];
    let offset: string | undefined;
    // Bounded: one person rarely has more than a handful of opportunities.
    for (let page = 0; page < 10; page++) {
      const params: Array<[string, string]> = [
        ['email', email],
        ['expand', 'stage'],
        ['expand', 'applications'],
        ['limit', '100'],
      ];
      if (offset) params.push(['offset', offset]);
      const r = await this.get<{ data?: RawOpportunity[]; hasNext?: boolean; next?: string }>('/opportunities', params);
      if (!Array.isArray(r.data)) throw new LeverError('bad_response');
      out.push(...r.data);
      if (!r.hasNext || !r.next) break;
      offset = r.next;
    }
    return out;
  }

  private async normalize(raw: RawOpportunity): Promise<LeverOpportunity> {
    const app = raw.applications?.[0];
    const postingId = app && typeof app === 'object' ? app.posting ?? null : null;
    const archived = !!raw.archived;
    let archivedReason: string | null = null;
    let hired = false;
    if (archived && raw.archived?.reason) {
      const r = (await this.reasons()).get(raw.archived.reason);
      archivedReason = r?.text ?? null;
      hired = r?.hired ?? false;
    }
    const stage = typeof raw.stage === 'string' ? null : raw.stage?.text ?? null;
    return {
      id: raw.id,
      postingTitle: postingId ? await this.postingTitle(postingId) : null,
      stage,
      archived,
      hired,
      archivedReason,
      createdAt: iso(raw.createdAt),
      updatedAt: iso(raw.updatedAt),
      leverUrl: leverOpportunityUrl(raw.id),
    };
  }

  async findByEmail(email: string): Promise<LeverStatus> {
    const checkedAt = new Date().toISOString();
    const base = { primary: null, opportunities: [] as LeverOpportunity[], checkedAt };
    if (!this.configured) return { state: 'ERROR', reason: 'unconfigured', ...base };

    const normalized = email.trim().toLowerCase();
    if (!normalized) return { state: 'NOT_FOUND', ...base };

    try {
      const raw = await this.listOpportunities(normalized);
      const opportunities = await Promise.all(raw.map((o) => this.normalize(o)));
      const primary = pickPrimary(opportunities);
      const state: LeverState = !primary
        ? 'NOT_FOUND'
        : !primary.archived
          ? 'ACTIVE'
          : primary.hired
            ? 'HIRED'
            : 'ARCHIVED';
      return { state, primary, opportunities, checkedAt };
    } catch (err) {
      const reason = err instanceof LeverError ? err.reason : 'unexpected';
      return { state: 'ERROR', reason, ...base };
    }
  }
}
