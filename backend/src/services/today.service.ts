// Today page summary (R4): a glanceable read-only snapshot in four queries.
//
//   1. inbox      per view × mailbox: waiting count, oldest waiting item,
//                 drafts expiring within 24h, sent today (the Inbox CTE, so
//                 the numbers match the Inbox tabs exactly)
//   2. messages   active mailboxes with their last received message, plus
//                 candidate replies per ET day for the last 14 days
//   3. sent       replies sent from the app (EmailDraft SENT) per ET day
//   4. lever      Interested candidates not in Lever; opportunities created
//                 today / this week (LEVER_OPPORTUNITY_CREATED logs)
//
// Timestamps leave the SQL as timestamptz (columns are UTC TIMESTAMP) so
// every driver reads the same instant.
//
// Read-only on purpose: unlike getInbox it doesn't release expired snoozes —
// the CTE already treats snoozedUntil <= now as back in its view.
import { Prisma } from '@prisma/client';
import { prisma } from '../db/client';
import { etMidnight, inboxItemsCte } from './inbox.service';

export const TODAY_SERIES_DAYS = 14;
const EXPIRING_SOON_MS = 24 * 3600_000;
const WAITING_VIEWS = ['needs_review', 'interested', 'not_interested'] as const;
type WaitingView = (typeof WAITING_VIEWS)[number];

export interface TodaySummary {
  generatedAt: string;
  views: Record<WaitingView, number>;
  sentToday: number;
  /** sortAt of the longest-waiting item in the three waiting views. */
  oldestWaitingAt: string | null;
  draftsExpiringSoon: number;
  mailboxes: Array<{ mailboxId: string; waiting: number; sentToday: number; lastReceivedAt: string | null }>;
  /** addedToday / addedThisWeek are team-wide even when mailboxId is set. */
  lever: { interestedNotInLever: number; addedToday: number; addedThisWeek: number };
  /** TODAY_SERIES_DAYS consecutive ET days, oldest first, ending today. */
  series: Array<{ day: string; received: number; sent: number }>;
}

export type SqlRunner = <T>(sql: Prisma.Sql) => Promise<T[]>;
const prismaRunner: SqlRunner = (sql) => prisma.$queryRaw(sql);

/** ET calendar date (YYYY-MM-DD) as a Postgres expression over a UTC timestamp column. */
const etDay = (col: Prisma.Sql) =>
  Prisma.sql`to_char((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD')`;

/** ET calendar dates for the window, plus the ET midnights the queries need. */
export function todayWindow(now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const [y, m, d] = [Number(get('year')), Number(get('month')) - 1, Number(get('day'))];
  // Noon UTC of an ET date is always inside that ET date.
  const midnightOf = (offsetDays: number) => etMidnight(new Date(Date.UTC(y, m, d + offsetDays, 17)));
  const days = Array.from({ length: TODAY_SERIES_DAYS }, (_, i) =>
    new Date(Date.UTC(y, m, d - (TODAY_SERIES_DAYS - 1 - i))).toISOString().slice(0, 10)
  );
  const sinceMonday = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 7) % 7;
  return {
    days,
    todayStart: midnightOf(0),
    seriesStart: midnightOf(-(TODAY_SERIES_DAYS - 1)),
    weekStart: midnightOf(-sinceMonday),
  };
}

interface Params {
  now: Date;
  mailboxId?: string;
  todayStart: Date;
  seriesStart: Date;
  weekStart: Date;
}

export function todayInboxSql({ now, mailboxId }: Params): Prisma.Sql {
  const soon = new Date(now.getTime() + EXPIRING_SOON_MS);
  return Prisma.sql`${inboxItemsCte({ now, mailboxId })}
    SELECT view, "mailboxId", COUNT(*)::int AS count, MIN("sortAt") AT TIME ZONE 'UTC' AS "oldestAt",
      COUNT(*) FILTER (WHERE "expiresAt" <= ${soon})::int AS "expiringSoon"
    FROM inbox_items
    WHERE view IN (${Prisma.join([...WAITING_VIEWS, 'sent_today'])})
    GROUP BY view, "mailboxId"`;
}

/**
 * Received = not from the mailbox's own address or a sendAs alias. The
 * series only counts candidate replies (sender = the thread's candidate), so
 * colleagues on CC don't inflate it.
 */
export function todayMessagesSql({ mailboxId, seriesStart }: Params): Prisma.Sql {
  const scope = mailboxId ? Prisma.sql`AND id = ${mailboxId}` : Prisma.empty;
  return Prisma.sql`
    WITH mb AS (
      SELECT id, lower("emailAddress") AS own, "sendAsAddresses" AS aliases
      FROM "Mailbox" WHERE "isActive" ${scope}
    ),
    last_in AS (
      SELECT m."mailboxId", MAX(m."receivedAt") AT TIME ZONE 'UTC' AS at
      FROM "EmailMessage" m JOIN mb ON mb.id = m."mailboxId"
      WHERE lower(m."fromAddress") <> mb.own AND NOT (lower(m."fromAddress") = ANY(mb.aliases))
      GROUP BY m."mailboxId"
    ),
    per_day AS (
      SELECT ${etDay(Prisma.sql`m."receivedAt"`)} AS day, COUNT(*)::int AS count
      FROM "EmailMessage" m
      JOIN mb ON mb.id = m."mailboxId"
      JOIN "EmailThread" t ON t.id = m."threadId"
      JOIN "Candidate" c ON c.id = t."candidateId"
      WHERE m."receivedAt" >= ${seriesStart} AND lower(m."fromAddress") = lower(c.email)
      GROUP BY 1
    )
    SELECT 'mailbox'::text AS kind, mb.id AS "mailboxId", NULL::text AS day, last_in.at, 0 AS count
    FROM mb LEFT JOIN last_in ON last_in."mailboxId" = mb.id
    UNION ALL
    SELECT 'day'::text, NULL::text, day, NULL::timestamptz, count FROM per_day`;
}

export function todaySentSql({ mailboxId, seriesStart }: Params): Prisma.Sql {
  const scope = mailboxId ? Prisma.sql`AND t."mailboxId" = ${mailboxId}` : Prisma.empty;
  return Prisma.sql`
    SELECT ${etDay(Prisma.sql`d."sentAt"`)} AS day, COUNT(*)::int AS count
    FROM "EmailDraft" d JOIN "EmailThread" t ON t.id = d."threadId"
    WHERE d.status = 'SENT' AND d."sentAt" >= ${seriesStart} ${scope}
    GROUP BY 1`;
}

export function todayLeverSql({ mailboxId, todayStart, weekStart }: Params): Prisma.Sql {
  const scope = mailboxId ? Prisma.sql`AND c."mailboxId" = ${mailboxId}` : Prisma.empty;
  return Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM "Candidate" c
        WHERE c.status = 'INTERESTED' AND c."leverState" = 'NOT_FOUND' ${scope}) AS "interestedNotInLever",
      COUNT(*) FILTER (WHERE l."createdAt" >= ${todayStart})::int AS "addedToday",
      COUNT(*)::int AS "addedThisWeek"
    FROM "SystemLog" l
    WHERE l.event = 'LEVER_OPPORTUNITY_CREATED' AND l."createdAt" >= ${weekStart}`;
}

const isoOrNull = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

export async function getTodaySummary(
  q: { mailboxId?: string },
  now: Date = new Date(),
  run: SqlRunner = prismaRunner
): Promise<TodaySummary> {
  const w = todayWindow(now);
  const p: Params = { now, mailboxId: q.mailboxId, ...w };

  const [inboxRows, messageRows, sentRows, leverRows] = await Promise.all([
    run<{ view: string; mailboxId: string | null; count: number; oldestAt: Date | null; expiringSoon: number }>(todayInboxSql(p)),
    run<{ kind: 'mailbox' | 'day'; mailboxId: string | null; day: string | null; at: Date | null; count: number }>(
      todayMessagesSql(p)
    ),
    run<{ day: string; count: number }>(todaySentSql(p)),
    run<{ interestedNotInLever: number; addedToday: number; addedThisWeek: number }>(todayLeverSql(p)),
  ]);

  const views = { needs_review: 0, interested: 0, not_interested: 0 };
  let sentToday = 0;
  let oldest: number | null = null;
  let draftsExpiringSoon = 0;
  const waitingBy = new Map<string, number>();
  const sentBy = new Map<string, number>();
  for (const r of inboxRows) {
    const n = Number(r.count);
    if (r.view === 'sent_today') {
      sentToday += n;
      if (r.mailboxId) sentBy.set(r.mailboxId, (sentBy.get(r.mailboxId) ?? 0) + n);
      continue;
    }
    views[r.view as WaitingView] += n;
    draftsExpiringSoon += Number(r.expiringSoon);
    if (r.mailboxId) waitingBy.set(r.mailboxId, (waitingBy.get(r.mailboxId) ?? 0) + n);
    if (r.oldestAt) {
      const t = new Date(r.oldestAt).getTime();
      if (oldest === null || t < oldest) oldest = t;
    }
  }

  const received = new Map<string, number>();
  const mailboxes: TodaySummary['mailboxes'] = [];
  for (const r of messageRows) {
    if (r.kind === 'day' && r.day) received.set(r.day, Number(r.count));
    if (r.kind === 'mailbox' && r.mailboxId) {
      mailboxes.push({
        mailboxId: r.mailboxId,
        waiting: waitingBy.get(r.mailboxId) ?? 0,
        sentToday: sentBy.get(r.mailboxId) ?? 0,
        lastReceivedAt: isoOrNull(r.at),
      });
    }
  }
  const sent = new Map(sentRows.map((r) => [r.day, Number(r.count)]));
  const lever = leverRows[0];

  return {
    generatedAt: now.toISOString(),
    views,
    sentToday,
    oldestWaitingAt: oldest === null ? null : new Date(oldest).toISOString(),
    draftsExpiringSoon,
    mailboxes,
    lever: {
      interestedNotInLever: Number(lever?.interestedNotInLever ?? 0),
      addedToday: Number(lever?.addedToday ?? 0),
      addedThisWeek: Number(lever?.addedThisWeek ?? 0),
    },
    series: w.days.map((day) => ({ day, received: received.get(day) ?? 0, sent: sent.get(day) ?? 0 })),
  };
}
