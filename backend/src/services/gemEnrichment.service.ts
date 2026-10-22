// Gem enrichment cache on Candidate (H5). The Add to Lever dialog reads
// Candidate.gem* instead of waiting on GeMCP; this module fills it:
//   - in the background when a new Candidate is created (gmail.service,
//     next to H2's scheduleLeverRefresh), as the mailbox owner's Gem
//     connection, else any admin's;
//   - when the Gem prefill serves a stale row (addToLever.service).
// Stores what the dialog shows — person id, title, company, location,
// whether a résumé exists, and LinkedIn (only into an empty column). Never
// the résumé file, its presigned URL, or the phone number.
import { waitUntil } from '@vercel/functions';
import { prisma } from '../db/client';
import { lookupGemPerson, GEM_STATUS_OK, type GemLookup } from './gem.service';
import { logEvent } from './monitoring.service';
import { safeError } from '../lib/safeError';

/** A FOUND row is served without a Gem call for this long. */
export const GEM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A NOT_FOUND row is trusted for less: people get added to Gem after first contact. */
export const GEM_NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CONCURRENT = 2;

/** Swappable for tests. */
export const gemEnrichmentDeps: {
  lookup: (userId: string, email: string, opts?: { extId?: string | null }) => Promise<GemLookup>;
} = {
  lookup: (userId, email, opts) => lookupGemPerson(userId, email, opts),
};

export type GemCacheState = 'fresh' | 'stale' | 'missing';

export function gemCacheState(
  c: { gemPersonId: string | null; gemFetchedAt: Date | string | null } | null | undefined,
  now: number = Date.now()
): GemCacheState {
  if (!c?.gemFetchedAt) return 'missing';
  const age = now - new Date(c.gemFetchedAt).getTime();
  if (c.gemPersonId) return age < GEM_CACHE_TTL_MS ? 'fresh' : 'stale';
  return age < GEM_NOT_FOUND_TTL_MS ? 'fresh' : 'missing';
}

/** Writes a FOUND / NOT_FOUND lookup onto the candidate; other outcomes leave the cache alone. */
export async function persistGemEnrichment(candidateId: string, gem: GemLookup): Promise<void> {
  if (gem.status === 'FOUND' && gem.person) {
    const p = gem.person;
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        gemPersonId: p.id,
        gemTitle: p.title,
        gemCompany: p.company,
        gemLocation: p.location,
        gemResumeAvailable: !!p.resume,
        gemFetchedAt: new Date(),
      },
    });
    if (p.linkedinUrl) {
      // A typed/stored URL wins over Gem's.
      await prisma.candidate.updateMany({ where: { id: candidateId, linkedinUrl: null }, data: { linkedinUrl: p.linkedinUrl } });
    }
  } else if (gem.status === 'NOT_FOUND') {
    await prisma.candidate.update({
      where: { id: candidateId },
      data: {
        gemPersonId: null,
        gemTitle: null,
        gemCompany: null,
        gemLocation: null,
        gemResumeAvailable: null,
        gemFetchedAt: new Date(),
      },
    });
  }
}

const OK_CONNECTION = { is: { status: GEM_STATUS_OK, tokens: { not: null } } };

/** App user whose Gem connection does a background lookup: the mailbox owner, else any admin. */
export async function pickGemUser(hint: { mailboxEmail?: string | null }): Promise<string | null> {
  if (hint.mailboxEmail) {
    const owner = await prisma.user.findFirst({
      where: { email: { equals: hint.mailboxEmail, mode: 'insensitive' }, gemConnection: OK_CONNECTION },
      select: { id: true },
    });
    if (owner) return owner.id;
  }
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', gemConnection: OK_CONNECTION },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return admin?.id ?? null;
}

const OUTCOME: Record<GemLookup['status'], string> = {
  FOUND: 'found',
  NOT_FOUND: 'not_found',
  NOT_CONNECTED: 'not_connected',
  NEEDS_REAUTH: 'needs_reauth',
  UNAVAILABLE: 'error',
};

/**
 * One background lookup. `userId` (the recruiter who opened a stale row)
 * wins; otherwise pickGemUser. Returns the outcome, or 'skipped' when no
 * Gem connection is available.
 */
export async function enrichCandidateFromGem(
  candidateId: string,
  opts: { userId?: string; mailboxEmail?: string | null }
): Promise<string> {
  const candidate = await prisma.candidate.findUnique({
    where: { id: candidateId },
    select: { id: true, email: true, gemPersonId: true, mailbox: { select: { emailAddress: true } } },
  });
  if (!candidate) return 'skipped';
  const userId =
    opts.userId ?? (await pickGemUser({ mailboxEmail: opts.mailboxEmail ?? candidate.mailbox?.emailAddress ?? null }));
  if (!userId) return 'skipped';
  const gem = await gemEnrichmentDeps.lookup(userId, candidate.email, { extId: candidate.gemPersonId ?? null });
  await persistGemEnrichment(candidateId, gem);
  return OUTCOME[gem.status];
}

// ── Background scheduling (per function instance) ─────────────────────────

let active = 0;
const waiting: Array<() => void> = [];
const scheduled = new Set<string>();

/** Tests only. */
export function __resetGemEnrichmentState(): void {
  active = 0;
  waiting.length = 0;
  scheduled.clear();
}

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
  // Hand the slot straight to the next waiter so a new caller can't jump in.
  const next = waiting.shift();
  if (next) next();
  else active -= 1;
}

export type GemEnrichReason = 'created' | 'stale';

/**
 * Fire-and-forget enrichment in waitUntil: at most 2 lookups at once per
 * instance, one per candidate at a time. Errors are logged (no PII) and
 * swallowed. GEM_BACKGROUND_ENRICH=false turns it off.
 */
export function scheduleGemEnrichment(
  candidateId: string,
  reason: GemEnrichReason,
  opts: { userId?: string; mailboxEmail?: string | null } = {}
): void {
  if (process.env.GEM_BACKGROUND_ENRICH === 'false') return;
  if (scheduled.has(candidateId)) return;
  scheduled.add(candidateId);
  const work = (async () => {
    await acquire();
    const t0 = Date.now();
    try {
      const outcome = await enrichCandidateFromGem(candidateId, opts);
      if (outcome !== 'skipped') {
        await logEvent('GEM_ENRICH', { candidateId, reason, outcome, durationMs: Date.now() - t0 }, 'INFO');
      }
    } catch (err) {
      await logEvent('GEM_ENRICH', { candidateId, reason, outcome: 'error', error: safeError(err).message.slice(0, 200) }, 'WARN');
    } finally {
      release();
      scheduled.delete(candidateId);
    }
  })();
  waitUntil(work);
}
