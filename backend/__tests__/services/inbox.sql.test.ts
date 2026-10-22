// Inbox view rules live in SQL (one grouped counts query, one keyset items
// query). These run that exact SQL against real Postgres (PGlite) with every
// migration applied.
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { migratedDb } from '../_setup/pglite';
import {
  inboxCountsSql,
  inboxItemsSql,
  inboxRoleCountsSql,
  etMidnight,
  type InboxRoleFilter,
  type InboxView,
} from '../../src/services/inbox.service';

const NOW = new Date('2026-10-22T15:00:00Z'); // 11:00 ET
const H = 3600_000;
const D = 24 * H;
const iso = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

async function run<T>(db: PGlite, sql: Prisma.Sql): Promise<T[]> {
  return (await db.query<T>(sql.text, sql.values as unknown[])).rows;
}

interface DraftSeed {
  id: string;
  status: string;
  classification?: string;
  confidence?: number;
  createdAt?: number;
  snoozedUntil?: number;
  sentAt?: number;
  mailbox?: string;
  candidateStatus?: string;
  repliedAt?: number;
}

const DRAFTS: DraftSeed[] = [
  { id: 'd_int', status: 'PENDING', classification: 'INTERESTED', createdAt: -2 * H },
  { id: 'd_not', status: 'PENDING', classification: 'NOT_INTERESTED', confidence: 0.95, createdAt: -3 * H },
  { id: 'd_approved', status: 'APPROVED', classification: 'NOT_INTERESTED', createdAt: -4 * H },
  { id: 'd_low', status: 'PENDING', classification: 'INTERESTED', confidence: 0.5, createdAt: -5 * H, candidateStatus: 'NEEDS_REVIEW' },
  { id: 'd_neutral', status: 'PENDING', classification: 'NEUTRAL', createdAt: -6 * H },
  { id: 'd_failed', status: 'FAILED', classification: 'INTERESTED', createdAt: -7 * H },
  { id: 'd_snoozed', status: 'PENDING', classification: 'INTERESTED', createdAt: -8 * H, snoozedUntil: D },
  { id: 'd_snooze_over', status: 'PENDING', classification: 'INTERESTED', createdAt: -9 * H, snoozedUntil: -H },
  { id: 'd_expired', status: 'PENDING', classification: 'INTERESTED', createdAt: -22 * D },
  { id: 'd_stale', status: 'PENDING', classification: 'INTERESTED', createdAt: -10 * H, repliedAt: -H },
  { id: 'd_sched', status: 'SCHEDULED', classification: 'INTERESTED', createdAt: -11 * H },
  { id: 'd_sent_today', status: 'SENT', classification: 'INTERESTED', createdAt: -D, sentAt: -H },
  // 03:00Z = 23:00 ET yesterday.
  { id: 'd_sent_yday', status: 'SENT', classification: 'INTERESTED', createdAt: -D, sentAt: -12 * H },
  { id: 'd_discarded', status: 'DISCARDED', classification: 'INTERESTED', createdAt: -H },
  { id: 'd_mb2', status: 'PENDING', classification: 'INTERESTED', createdAt: -30 * 60_000, mailbox: 'mb2' },
];

async function seed(db: PGlite): Promise<void> {
  await db.exec(`
    INSERT INTO "Mailbox" (id, "emailAddress", "updatedAt") VALUES ('mb1', 'a@archive.com', now()), ('mb2', 'b@archive.com', now());
  `);
  for (const d of DRAFTS) {
    const mb = d.mailbox ?? 'mb1';
    await db.query(
      `INSERT INTO "Candidate" (id, name, email, status, "mailboxId", "repliedAt", "lastInboundAt", "updatedAt")
       VALUES ($1, $1, $1 || '@x.com', $2, $3, $4, $5, $5)`,
      [`c_${d.id}`, d.candidateStatus ?? 'INTERESTED', mb, d.repliedAt === undefined ? null : iso(d.repliedAt), iso(d.createdAt ?? 0)]
    );
    await db.query(
      `INSERT INTO "EmailThread" (id, "candidateId", "mailboxId", "externalThreadId", subject) VALUES ($1, $2, $3, $1, 's')`,
      [`t_${d.id}`, `c_${d.id}`, mb]
    );
    await db.query(
      `INSERT INTO "EmailDraft" (id, "threadId", subject, "bodyText", classification, confidence, status,
         "createdAt", "updatedAt", "snoozedUntil", "sentAt")
       VALUES ($1, $2, 's', 'b', $3, $4, $5, $6, $6, $7, $8)`,
      [
        d.id,
        `t_${d.id}`,
        d.classification ?? 'INTERESTED',
        d.confidence ?? 0.9,
        d.status,
        iso(d.createdAt ?? 0),
        d.snoozedUntil === undefined ? null : iso(d.snoozedUntil),
        d.sentAt === undefined ? null : iso(d.sentAt),
      ]
    );
  }
  // NEEDS_REVIEW candidates without a draft: one recent, one past expiry.
  await db.query(
    `INSERT INTO "Candidate" (id, name, email, status, "mailboxId", "lastInboundAt", "updatedAt") VALUES
       ('c_review', 'r', 'r@x.com', 'NEEDS_REVIEW', 'mb1', $1, $1),
       ('c_review_old', 'o', 'o@x.com', 'NEEDS_REVIEW', 'mb1', $2, $2),
       ('c_review_mb2', 'm', 'm@x.com', 'NEEDS_REVIEW', 'mb2', $1, $1)`,
    [iso(-90 * 60_000), iso(-30 * D)]
  );
}

describe('inbox SQL (U0)', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migratedDb();
    await seed(db);
    // Roles for the role-filter tests; a blank role counts as unknown.
    await db.exec(`
      UPDATE "Candidate" SET role = 'Engineer' WHERE id IN ('c_d_low', 'c_review', 'c_d_int');
      UPDATE "Candidate" SET role = 'Designer' WHERE id = 'c_d_neutral';
      UPDATE "Candidate" SET role = '   ' WHERE id = 'c_d_failed';
    `);
  }, 60_000);

  async function ids(
    view: InboxView,
    extra: { mailboxId?: string; order?: 'newest' | 'oldest'; roleFilter?: InboxRoleFilter } = {}
  ) {
    const rows = await run<{ id: string; kind: string }>(
      db,
      inboxItemsSql({
        view,
        now: NOW,
        limit: 100,
        order: extra.order ?? 'newest',
        mailboxId: extra.mailboxId,
        cursor: null,
        roleFilter: extra.roleFilter,
      })
    );
    return rows.map((r) => `${r.kind === 'candidate' ? 'cand:' : ''}${r.id}`);
  }

  it('ET midnight follows daylight saving', () => {
    expect(etMidnight(NOW).toISOString()).toBe('2026-10-22T04:00:00.000Z');
    expect(etMidnight(new Date('2026-12-01T03:00:00Z')).toISOString()).toBe('2026-11-30T05:00:00.000Z');
  });

  it('interested = confident INTERESTED drafts, newest first; snooze-expired ones are back', async () => {
    expect(await ids('interested')).toEqual(['d_mb2', 'd_int', 'd_snooze_over']);
  });

  it('not_interested includes legacy APPROVED drafts', async () => {
    expect(await ids('not_interested')).toEqual(['d_not', 'd_approved']);
  });

  it('needs_review = low confidence, NEUTRAL, FAILED sends, and NEEDS_REVIEW candidates with no draft', async () => {
    expect(await ids('needs_review')).toEqual(['cand:c_review_mb2', 'cand:c_review', 'd_low', 'd_neutral', 'd_failed']);
  });

  it('snoozed = still snoozed only', async () => {
    expect(await ids('snoozed')).toEqual(['d_snoozed']);
  });

  it('sent_today = sent since ET midnight plus in-flight sends', async () => {
    expect((await ids('sent_today')).sort()).toEqual(['d_sched', 'd_sent_today']);
  });

  it('expired, stale (answered outside the app) and discarded drafts are in no view', async () => {
    const all = (
      await Promise.all((['needs_review', 'interested', 'not_interested', 'snoozed', 'sent_today'] as const).map((v) => ids(v)))
    ).flat();
    for (const gone of ['d_expired', 'd_stale', 'd_discarded', 'd_sent_yday', 'cand:c_review_old']) {
      expect(all).not.toContain(gone);
    }
  });

  it('oldest-waiting-first reverses the order', async () => {
    expect(await ids('interested', { order: 'oldest' })).toEqual(['d_snooze_over', 'd_int', 'd_mb2']);
  });

  it('filters by mailbox', async () => {
    expect(await ids('interested', { mailboxId: 'mb2' })).toEqual(['d_mb2']);
    expect(await ids('needs_review', { mailboxId: 'mb2' })).toEqual(['cand:c_review_mb2']);
  });

  it('counts every view in one grouped query, matching the item lists', async () => {
    const rows = await run<{ view: string; count: number }>(db, inboxCountsSql({ now: NOW }));
    const counts = Object.fromEntries(rows.map((r) => [r.view, Number(r.count)]));
    expect(counts).toEqual({ needs_review: 5, interested: 3, not_interested: 2, snoozed: 1, sent_today: 2 });
  });

  it('keyset cursor pages without gaps or repeats', async () => {
    const page1 = await run<{ id: string; kind: string; sortAt: Date }>(
      db,
      inboxItemsSql({ view: 'needs_review', now: NOW, limit: 2, order: 'newest', cursor: null })
    );
    expect(page1.map((r) => r.id)).toEqual(['c_review_mb2', 'c_review']);
    const last = page1[1];
    const page2 = await run<{ id: string }>(
      db,
      inboxItemsSql({
        view: 'needs_review',
        now: NOW,
        limit: 10,
        order: 'newest',
        cursor: { sortAt: new Date(last.sortAt), kind: last.kind as 'draft' | 'candidate', id: last.id },
      })
    );
    expect(page2.map((r) => r.id)).toEqual(['d_low', 'd_neutral', 'd_failed']);
  });

  it('filters by role; __none__ (unknown) matches null and blank roles', async () => {
    expect(await ids('needs_review', { roleFilter: { roles: ['Engineer'], unknown: false } })).toEqual(['cand:c_review', 'd_low']);
    expect(await ids('needs_review', { roleFilter: { roles: [], unknown: true } })).toEqual(['cand:c_review_mb2', 'd_failed']);
    expect(await ids('needs_review', { roleFilter: { roles: ['Designer'], unknown: true } })).toEqual([
      'cand:c_review_mb2',
      'd_neutral',
      'd_failed',
    ]);
    expect(await ids('needs_review', { roleFilter: { roles: ['Engineer'], unknown: false }, order: 'oldest' })).toEqual([
      'd_low',
      'cand:c_review',
    ]);
  });

  it('role filter narrows only the current view\'s count', async () => {
    const rows = await run<{ view: string; count: number }>(
      db,
      inboxCountsSql({ now: NOW, view: 'needs_review', roleFilter: { roles: ['Engineer'], unknown: false } })
    );
    const counts = Object.fromEntries(rows.map((r) => [r.view, Number(r.count)]));
    expect(counts).toEqual({ needs_review: 2, interested: 3, not_interested: 2, snoozed: 1, sent_today: 2 });
  });

  it('role counts for a view in one grouped query, unknown as null', async () => {
    const rows = await run<{ role: string | null; count: number }>(db, inboxRoleCountsSql({ now: NOW, view: 'needs_review' }));
    const byRole = Object.fromEntries(rows.map((r) => [String(r.role), Number(r.count)]));
    expect(byRole).toEqual({ Engineer: 2, Designer: 1, null: 2 });
  });
});
