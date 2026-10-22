// Lever client for F3 "Add to Lever": the reads the dialog needs (open
// postings, Lever user by email, stages) plus the only two writes this app
// makes — create an opportunity and add a note. lever.service.ts stays the
// read-only status client; both share its 8 req/s token bucket.
//
// Writes are never retried on timeout/5xx: Lever may have processed the
// request, and a retry would create a second opportunity. 429 is retried
// (Lever rejected it before processing). Callers gate every write behind
// LEVER_CREATE_ENABLED (addToLever.service.ts).
import { LEVER_API_BASE, sharedBucket } from './lever.service';

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export interface LeverPosting {
  id: string;
  title: string;
  team: string | null;
  location: string | null;
  /** 'published' | 'internal' */
  state: string;
}

export interface LeverUser {
  id: string;
  name: string | null;
  email: string;
}

export interface LeverStage {
  id: string;
  text: string;
}

export interface LeverResumeFile {
  filename: string;
  contentType: string;
  data: Uint8Array;
}

export interface CreateOpportunityInput {
  name: string;
  headline?: string | null;
  location?: string | null;
  email: string;
  phone?: string | null;
  links: string[];
  tags: string[];
  sources: string[];
  stageId?: string | null;
  /** Lever accepts exactly one posting per create request. */
  postingId: string;
  /** Sent as multipart `resumeFile` with `parse=true`. */
  resume?: LeverResumeFile | null;
}

/** A failed Lever call. `message` is safe to show a recruiter. */
export class LeverWriteError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'LeverWriteError';
  }
}

export interface LeverWriteClientOptions {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  rateLimiter?: { take(): Promise<void> };
  timeoutMs?: number;
}

function readableError(status: number, leverMessage: string | undefined): LeverWriteError {
  if (status === 401 || status === 403) {
    return new LeverWriteError(
      status,
      'Lever refused: the API key lacks permission for this (needs opportunities:write:admin / notes:write).'
    );
  }
  if (status === 404) return new LeverWriteError(status, `Lever could not find that${leverMessage ? `: ${leverMessage}` : '.'}`);
  if (status === 429) return new LeverWriteError(status, 'Lever is rate limiting us — try again in a minute.');
  if (status >= 500) {
    return new LeverWriteError(status, `Lever had an error (${status}). Check Lever before retrying so you don't add the candidate twice.`);
  }
  return new LeverWriteError(status, `Lever rejected the request: ${leverMessage ?? `HTTP ${status}`}`);
}

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === 'string' && s.trim() !== '';
}

export class LeverWriteClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly limiter: { take(): Promise<void> };
  private readonly timeoutMs: number;

  constructor(opts: LeverWriteClientOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.LEVER_API_KEY ?? '';
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? realSleep;
    this.limiter = opts.rateLimiter ?? sharedBucket;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  get configured(): boolean {
    return this.apiKey.trim() !== '';
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Array<[string, string]>,
    body?: unknown
  ): Promise<T> {
    if (!this.configured) throw new LeverWriteError(503, 'Lever is not configured (LEVER_API_KEY missing).');
    const url = new URL(LEVER_API_BASE + path);
    for (const [k, v] of params) url.searchParams.append(k, v);

    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' };
    let payload: RequestInit["body"];
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const maxAttempts = method === 'GET' ? 3 : 2;
    for (let attempt = 1; ; attempt++) {
      await this.limiter.take();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let res: Response;
      try {
        res = await this.fetchImpl(url.toString(), { method, headers, body: payload, signal: controller.signal });
      } catch (err) {
        if (method === 'GET' && attempt < maxAttempts) {
          await this.sleep(500 * attempt);
          continue;
        }
        const timedOut = (err as Error)?.name === 'AbortError';
        throw new LeverWriteError(
          504,
          timedOut
            ? "Lever didn't respond in time. Check Lever before retrying so you don't add the candidate twice."
            : 'Could not reach Lever.'
        );
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new LeverWriteError(502, 'Lever returned an unreadable response.');
        }
      }
      const retryable = res.status === 429 || (method === 'GET' && res.status >= 500);
      if (retryable && attempt < maxAttempts) {
        const ra = Number(res.headers.get('retry-after'));
        await this.sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 1000 * attempt);
        continue;
      }
      let leverMessage: string | undefined;
      try {
        const j = (await res.json()) as { message?: unknown };
        if (typeof j?.message === 'string') leverMessage = j.message.slice(0, 300);
      } catch {
        /* no body */
      }
      throw readableError(res.status, leverMessage);
    }
  }

  async listOpenPostings(): Promise<LeverPosting[]> {
    const out: LeverPosting[] = [];
    for (const state of ['published', 'internal']) {
      let offset: string | undefined;
      for (let page = 0; page < 20; page++) {
        const params: Array<[string, string]> = [
          ['state', state],
          ['distributionChannel', 'public'],
          ['distributionChannel', 'internal'],
          ['limit', '100'],
        ];
        if (offset) params.push(['offset', offset]);
        const r = await this.request<{
          data?: Array<{ id?: string; text?: string; state?: string; categories?: { team?: string; location?: string } }>;
          hasNext?: boolean;
          next?: string;
        }>('GET', '/postings', params);
        for (const p of r.data ?? []) {
          if (!p?.id) continue;
          out.push({
            id: p.id,
            title: p.text ?? '(untitled posting)',
            team: p.categories?.team ?? null,
            location: p.categories?.location ?? null,
            state: p.state ?? state,
          });
        }
        if (!r.hasNext || !r.next) break;
        offset = r.next;
      }
    }
    return out;
  }

  async findUserByEmail(email: string): Promise<LeverUser | null> {
    const normalized = email.trim().toLowerCase();
    const r = await this.request<{
      data?: Array<{ id?: string; name?: string; email?: string; deactivatedAt?: number | null }>;
    }>('GET', '/users', [['email', normalized]]);
    const u = (r.data ?? []).find((x) => x?.id && !x.deactivatedAt && (x.email ?? '').toLowerCase() === normalized);
    return u ? { id: u.id!, name: u.name ?? null, email: u.email!.toLowerCase() } : null;
  }

  async listStages(): Promise<LeverStage[]> {
    const r = await this.request<{ data?: Array<{ id?: string; text?: string }> }>('GET', '/stages', []);
    return (r.data ?? []).filter((s) => s?.id && s.text).map((s) => ({ id: s.id!, text: s.text! }));
  }

  async createOpportunity(input: CreateOpportunityInput, performAs: string): Promise<{ id: string }> {
    const params: Array<[string, string]> = [['perform_as', performAs]];
    const fields = {
      name: input.name.trim(),
      headline: nonEmpty(input.headline) ? input.headline.trim() : undefined,
      location: nonEmpty(input.location) ? input.location.trim() : undefined,
      origin: 'sourced',
      owner: performAs,
      stage: nonEmpty(input.stageId) ? input.stageId : undefined,
    };
    const arrays = {
      emails: [input.email.trim().toLowerCase()],
      links: input.links.filter(nonEmpty),
      tags: input.tags.filter(nonEmpty),
      sources: input.sources.filter(nonEmpty),
      postings: [input.postingId],
    };

    let body: unknown;
    if (input.resume) {
      params.push(['parse', 'true']);
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
      for (const [k, list] of Object.entries(arrays)) for (const v of list) form.append(`${k}[]`, v);
      // Phones are left to résumé parsing in multipart: Lever's form encoding
      // for phone objects is undocumented. The JSON path sends them.
      form.append(
        'resumeFile',
        new Blob([input.resume.data], { type: input.resume.contentType }),
        input.resume.filename
      );
      body = form;
    } else {
      const json: Record<string, unknown> = {
        name: fields.name,
        ...(fields.headline && { headline: fields.headline }),
        ...(fields.location && { location: fields.location }),
        emails: arrays.emails,
        ...(nonEmpty(input.phone) && { phones: [{ value: input.phone.trim() }] }),
        links: arrays.links,
        tags: arrays.tags,
        sources: arrays.sources,
        origin: fields.origin,
        owner: fields.owner,
        ...(fields.stage && { stage: fields.stage }),
        postings: arrays.postings,
      };
      body = json;
    }

    const r = await this.request<{ data?: { id?: string } }>('POST', '/opportunities', params, body);
    if (!r.data?.id) throw new LeverWriteError(502, 'Lever did not return the new opportunity id.');
    return { id: r.data.id };
  }

  async addNote(opportunityId: string, text: string, performAs: string): Promise<void> {
    await this.request('POST', `/opportunities/${encodeURIComponent(opportunityId)}/notes`, [['perform_as', performAs]], {
      value: text,
    });
  }
}
