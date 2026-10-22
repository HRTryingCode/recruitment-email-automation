import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Audit B4 (ingestion reliability): reconcile query/tombstones (M25), P2002 as
// success (L2), history cursor only past successes (L1), monotonic
// lastMessageAt (M24), processingState + sweeper (M3), stateless webhook
// dedupe (L2), one live draft per thread under a race (L3), users.stop (L4).
//
// Prisma is an in-memory fake that models the constraints the code relies on:
// EmailMessage.externalMessageId is unique, and the partial unique index
// EmailDraft(threadId) WHERE status IN (PENDING, APPROVED) from migration 9.

const gmailApi = vi.hoisted(() => ({
  messagesGet: vi.fn(),
  messagesList: vi.fn(),
  historyList: vi.fn(),
  getProfile: vi.fn(),
  stop: vi.fn(),
  watch: vi.fn(),
  sendAsList: vi.fn(),
}));

const claude = vi.hoisted(() => ({
  classifyReply: vi.fn(),
  generateDraftReply: vi.fn(),
  generateHandoffDraftReply: vi.fn(),
}));

vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials() {}
    getAccessToken = vi.fn().mockResolvedValue({ token: 'at' });
    generateAuthUrl() {
      return 'https://example.test';
    }
  }
  return {
    google: {
      auth: { OAuth2 },
      gmail: () => ({
        users: {
          messages: { get: gmailApi.messagesGet, list: gmailApi.messagesList },
          history: { list: gmailApi.historyList },
          getProfile: gmailApi.getProfile,
          stop: gmailApi.stop,
          watch: gmailApi.watch,
          settings: { sendAs: { list: gmailApi.sendAsList } },
        },
      }),
      oauth2: () => ({ userinfo: { get: vi.fn() } }),
    },
  };
});

vi.mock('../../src/services/claude.service', () => ({
  classifyReply: claude.classifyReply,
  generateDraftReply: claude.generateDraftReply,
  generateHandoffDraftReply: claude.generateHandoffDraftReply,
  getHandoffType: () => 'default',
}));

// ---- in-memory prisma -------------------------------------------------------

type Row = Record<string, any>;

const db = vi.hoisted(() => ({
  mailboxes: [] as Row[],
  threads: [] as Row[],
  messages: [] as Row[],
  drafts: [] as Row[],
  candidates: [] as Row[],
  tombstones: [] as Row[],
  logs: [] as Row[],
  seq: 0,
}));

function p2002(target: string): Error {
  const err = new Error(`Unique constraint failed on the fields: (${target})`) as Error & {
    code: string;
  };
  err.code = 'P2002';
  return err;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !(cond.in as unknown[]).includes(v)) return false;
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('gt' in cond && !(v > cond.gt)) return false;
      if ('not' in cond && v === cond.not) return false;
      if ('equals' in cond && String(v).toLowerCase() !== String(cond.equals).toLowerCase()) return false;
      return true;
    }
    return v === cond;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] = (row[k] ?? 0) + v.increment;
    else row[k] = v;
  }
}

const id = (prefix: string) => `${prefix}-${++db.seq}`;
const isLive = (d: Row) => d.status === 'PENDING' || d.status === 'APPROVED';

vi.mock('../../src/db/client', () => {
  const prisma = {
    mailbox: {
      findUnique: vi.fn(async ({ where }: Row) =>
        db.mailboxes.find((m) => (where.id ? m.id === where.id : m.emailAddress === where.emailAddress)) ?? null
      ),
      update: vi.fn(async ({ where, data }: Row) => {
        const m = db.mailboxes.find((x) => x.id === where.id)!;
        applyData(m, data);
        return m;
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.mailboxes.filter((m) => matches(m, where));
        rows.forEach((m) => applyData(m, data));
        return { count: rows.length };
      }),
    },
    emailThread: {
      upsert: vi.fn(async ({ where, update, create }: Row) => {
        const key = where.mailboxId_externalThreadId;
        let t = db.threads.find(
          (x) => x.mailboxId === key.mailboxId && x.externalThreadId === key.externalThreadId
        );
        if (t) applyData(t, update);
        else {
          t = { id: id('thread'), candidateId: null, ...create };
          db.threads.push(t!);
        }
        return { ...t };
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.threads.filter((t) => matches(t, where));
        rows.forEach((t) => applyData(t, data));
        return { count: rows.length };
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const t = db.threads.find((x) => x.id === where.id)!;
        applyData(t, data);
        return t;
      }),
    },
    emailMessage: {
      findUnique: vi.fn(async ({ where }: Row) =>
        db.messages.find((m) => m.externalMessageId === where.externalMessageId) ?? null
      ),
      findFirst: vi.fn(async ({ where }: Row) => db.messages.find((m) => matches(m, where)) ?? null),
      findMany: vi.fn(async ({ where, take, include }: Row) => {
        let rows = db.messages.filter((m) => matches(m, where));
        if (take) rows = rows.slice(0, take);
        if (!include) return rows;
        return rows.map((m) => ({
          ...m,
          thread: db.threads.find((t) => t.id === m.threadId),
          mailbox: db.mailboxes.find((x) => x.id === m.mailboxId),
        }));
      }),
      create: vi.fn(async ({ data }: Row) => {
        if (db.messages.some((m) => m.externalMessageId === data.externalMessageId)) {
          throw p2002('externalMessageId');
        }
        const row = { id: id('msg'), processingState: 'PROCESSED', attempts: 0, createdAt: new Date(), ...data };
        db.messages.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const m = db.messages.find((x) => x.id === where.id)!;
        applyData(m, data);
        return m;
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        const rows = db.messages.filter((m) => matches(m, where));
        rows.forEach((m) => applyData(m, data));
        return { count: rows.length };
      }),
    },
    emailDraft: {
      findFirst: vi.fn(async ({ where }: Row) => db.drafts.find((d) => matches(d, where)) ?? null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: Row) => {
        if (isLive(data) && db.drafts.some((d) => d.threadId === data.threadId && isLive(d))) {
          throw p2002('threadId');
        }
        const row = { id: id('draft'), ...data };
        db.drafts.push(row);
        return row;
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    candidate: {
      findUnique: vi.fn(async ({ where }: Row) => db.candidates.find((c) => c.email === where.email) ?? null),
      upsert: vi.fn(async ({ where, update, create }: Row) => {
        let c = db.candidates.find((x) => x.email === where.email);
        if (c) applyData(c, update);
        else {
          c = { id: id('cand'), ...create };
          db.candidates.push(c!);
        }
        return c;
      }),
      update: vi.fn(async () => ({})),
    },
    gmailFetchTombstone: {
      findMany: vi.fn(async ({ where }: Row) => db.tombstones.filter((t) => matches(t, where))),
      upsert: vi.fn(async ({ where, update, create }: Row) => {
        const key = where.mailboxId_externalMessageId;
        let t = db.tombstones.find(
          (x) => x.mailboxId === key.mailboxId && x.externalMessageId === key.externalMessageId
        );
        if (t) applyData(t, { ...update, updatedAt: new Date() });
        else {
          t = { id: id('tomb'), attempts: 1, createdAt: new Date(), updatedAt: new Date(), ...create };
          db.tombstones.push(t!);
        }
        return t;
      }),
    },
    systemLog: {
      create: vi.fn(async ({ data }: Row) => {
        db.logs.push(data);
        return data;
      }),
    },
  };
  return { prisma, default: prisma };
});

import {
  reconcileMailbox,
  syncIncremental,
  processWebhook,
  sweepStuckMessages,
  stopMailboxWatch,
  serializeCredentials,
} from '../../src/services/gmail.service';

// ---- fixtures ---------------------------------------------------------------

const OWNER = 'paul@archive.com';
const CANDIDATE = 'jane@candidate.test';

function seedMailbox(overrides: Row = {}): Row {
  const mb = {
    id: 'mb-paul',
    provider: 'GMAIL',
    emailAddress: OWNER,
    displayName: 'Paul',
    credentials: serializeCredentials({ refresh_token: 'rt', access_token: 'at' }),
    watchExpiry: null,
    lastHistoryId: '100',
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    lastReconciledAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
  db.mailboxes.push(mb);
  return mb;
}

function gmailMessage(msgId: string, opts: { from?: string; at?: string; thread?: string; subject?: string } = {}) {
  const at = new Date(opts.at ?? '2026-10-22T10:00:00Z');
  return {
    data: {
      id: msgId,
      threadId: opts.thread ?? 'gthread-1',
      internalDate: String(at.getTime()),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: `Jane <${opts.from ?? CANDIDATE}>` },
          { name: 'To', value: OWNER },
          { name: 'Subject', value: opts.subject ?? 'Re: Role at Archive' },
          { name: 'Date', value: at.toUTCString() },
          { name: 'Message-ID', value: `<${msgId}@mail.test>` },
        ],
        body: { data: Buffer.from('Sounds great, keen to chat!').toString('base64') },
      },
    },
  };
}

function gmailError(status: number, message: string): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.code = status;
  err.status = status;
  err.response = { status };
  return err;
}

function events(name?: string): Row[] {
  return name ? db.logs.filter((l) => l.event === name) : db.logs;
}

function interested() {
  return {
    classification: 'INTERESTED',
    messageType: 'FOLLOWUP',
    needsReview: false,
    confidence: 0.95,
    reasoning: 'keen',
    // A detected role is required for candidate creation (no-role replies
    // are skipped as non-recruiting).
    role: 'Software Engineer',
  };
}

beforeEach(() => {
  Object.assign(db, {
    mailboxes: [],
    threads: [],
    messages: [],
    drafts: [],
    candidates: [],
    tombstones: [],
    logs: [],
    seq: 0,
  });
  for (const fn of [...Object.values(gmailApi), ...Object.values(claude)]) fn.mockReset();
  gmailApi.sendAsList.mockRejectedValue(new Error('no settings scope'));
  gmailApi.getProfile.mockResolvedValue({ data: { historyId: '999' } });
  claude.classifyReply.mockResolvedValue(interested());
  claude.generateHandoffDraftReply.mockResolvedValue({
    subject: 'Re: Role at Archive',
    bodyText: 'Looping in Sofia',
    bodyHtml: '<p>Looping in Sofia</p>',
  });
  // Default list: reconcile query returns nothing; SENT-folder signature
  // lookup returns nothing.
  gmailApi.messagesList.mockResolvedValue({ data: { messages: [] } });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- tests -------------------------------------------------------------------

describe('reconcileMailbox (M25)', () => {
  it('excludes drafts and chats from the Gmail query', async () => {
    seedMailbox();
    await reconcileMailbox('mb-paul');
    const q = gmailApi.messagesList.mock.calls[0]![0].q as string;
    expect(q).toContain('-in:drafts');
    expect(q).toContain('-in:chats');
  });

  it('checks existence globally, not per mailbox', async () => {
    seedMailbox();
    // Stored under a different mailbox (e.g. internal mail seen by two inboxes).
    db.messages.push({ id: 'm0', mailboxId: 'mb-other', externalMessageId: 'g-1', processingState: 'PROCESSED' });
    gmailApi.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'g-1' }] } });

    const result = await reconcileMailbox('mb-paul');

    expect(result.missingBefore).toBe(0);
    expect(gmailApi.messagesGet).not.toHaveBeenCalled();
  });

  it('tombstones a 404 and does not refetch it within 48h', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValue({ data: { messages: [{ id: 'g-gone' }] } });
    gmailApi.messagesGet.mockRejectedValue(gmailError(404, 'Requested entity was not found.'));

    const first = await reconcileMailbox('mb-paul');
    expect(first.missingBefore).toBe(1);
    expect(first.ingested).toBe(0);
    expect(db.tombstones).toMatchObject([
      { mailboxId: 'mb-paul', externalMessageId: 'g-gone', reason: 'NOT_FOUND' },
    ]);
    // 404 is an expected outcome, not a processing failure.
    expect(events('MESSAGE_PROCESSING_FAILED')).toHaveLength(0);

    const second = await reconcileMailbox('mb-paul');
    expect(second.missingBefore).toBe(0);
    expect(gmailApi.messagesGet).toHaveBeenCalledTimes(1);
  });

  it('refetches a tombstoned id once the 48h window has passed', async () => {
    seedMailbox();
    db.tombstones.push({
      mailboxId: 'mb-paul',
      externalMessageId: 'g-1',
      reason: 'NOT_FOUND',
      attempts: 1,
      updatedAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
    });
    gmailApi.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'g-1' }] } });
    gmailApi.messagesGet.mockResolvedValueOnce(gmailMessage('g-1'));

    const result = await reconcileMailbox('mb-paul');
    expect(result.ingested).toBe(1);
  });

  it('stops at the deadline', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValueOnce({
      data: { messages: [{ id: 'g-1' }, { id: 'g-2' }] },
    });
    gmailApi.messagesGet.mockResolvedValue(gmailMessage('g-1'));
    const result = await reconcileMailbox('mb-paul', { deadline: Date.now() - 1 });
    expect(result.missingBefore).toBe(2);
    expect(result.ingested).toBe(0);
    expect(gmailApi.messagesGet).not.toHaveBeenCalled();
  });
});

describe('fetchAndStoreMessage store section (L2, M24, M3)', () => {
  it('treats a P2002 on externalMessageId as success (lost race), not a failure', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'g-1' }] } });
    gmailApi.messagesGet.mockImplementationOnce(async () => {
      // The webhook stores the same message while reconcile is fetching it.
      db.messages.push({ id: 'm-race', mailboxId: 'mb-paul', externalMessageId: 'g-1' });
      return gmailMessage('g-1');
    });

    const result = await reconcileMailbox('mb-paul');

    expect(result.ingested).toBe(0);
    expect(events('MESSAGE_PROCESSING_FAILED')).toHaveLength(0);
    expect(db.tombstones).toHaveLength(0);
  });

  it('never moves EmailThread.lastMessageAt backwards', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValueOnce({
      data: { messages: [{ id: 'g-new' }, { id: 'g-old' }] },
    });
    gmailApi.messagesGet.mockImplementation(async ({ id: msgId }: Row) =>
      msgId === 'g-new'
        ? gmailMessage('g-new', { at: '2026-10-22T12:00:00Z', subject: 'Re: newest' })
        : gmailMessage('g-old', { at: '2026-10-20T08:00:00Z', subject: 'Original' })
    );

    await reconcileMailbox('mb-paul');

    expect(db.threads).toHaveLength(1);
    expect(db.threads[0]!.lastMessageAt).toEqual(new Date('2026-10-22T12:00:00Z'));
    expect(db.threads[0]!.subject).toBe('Re: newest');
  });

  it('marks inbound messages PROCESSED after classification and outbound PROCESSED on store', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValueOnce({
      data: { messages: [{ id: 'g-in' }, { id: 'g-out' }] },
    });
    gmailApi.messagesGet.mockImplementation(async ({ id: msgId }: Row) =>
      msgId === 'g-in'
        ? gmailMessage('g-in', { at: '2026-10-22T10:00:00Z' })
        : gmailMessage('g-out', { from: OWNER, at: '2026-10-22T11:00:00Z' })
    );

    await reconcileMailbox('mb-paul');

    const byId = Object.fromEntries(db.messages.map((m) => [m.externalMessageId, m]));
    expect(byId['g-in']).toMatchObject({ processingState: 'PROCESSED', attempts: 1 });
    expect(byId['g-out']).toMatchObject({ processingState: 'PROCESSED' });
  });

  it('marks the row FAILED (not lost) when classification throws after the store', async () => {
    seedMailbox();
    gmailApi.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'g-1' }] } });
    gmailApi.messagesGet.mockResolvedValueOnce(gmailMessage('g-1'));
    // DB blip inside classifyAndDraft (candidate lookup).
    const { prisma } = await import('../../src/db/client');
    (prisma.candidate.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('P2024 timed out fetching a new connection')
    );

    const result = await reconcileMailbox('mb-paul');

    expect(result.ingested).toBe(1);
    expect(db.messages[0]).toMatchObject({ processingState: 'FAILED', attempts: 1 });
  });
});

describe('syncIncremental cursor (L1)', () => {
  function history(entries: Array<[string, string]>, latest = '200') {
    gmailApi.historyList.mockResolvedValueOnce({
      data: {
        historyId: latest,
        history: entries.map(([hid, msgId]) => ({ id: hid, messagesAdded: [{ message: { id: msgId } }] })),
      },
    });
  }

  it('advances to the latest historyId when every message succeeds', async () => {
    seedMailbox();
    history([['150', 'g-1']]);
    gmailApi.messagesGet.mockResolvedValueOnce(gmailMessage('g-1'));

    await syncIncremental('mb-paul', '180');

    expect(db.mailboxes[0]!.lastHistoryId).toBe('200');
  });

  it('holds the cursor just before the first failed message', async () => {
    seedMailbox();
    history([
      ['150', 'g-ok'],
      ['160', 'g-bad'],
      ['170', 'g-ok2'],
    ]);
    gmailApi.messagesGet.mockImplementation(async ({ id: msgId }: Row) => {
      if (msgId === 'g-bad') throw gmailError(500, 'Backend Error');
      return gmailMessage(msgId as string, { thread: `t-${msgId}` });
    });

    await syncIncremental('mb-paul', '180');

    expect(db.mailboxes[0]!.lastHistoryId).toBe('159');
    // Later messages are still stored; the re-read skips them as existing.
    expect(db.messages.map((m) => m.externalMessageId).sort()).toEqual(['g-ok', 'g-ok2']);
    const synced = events('MAILBOX_SYNCED_INCREMENTAL')[0]!;
    expect(JSON.parse(synced.details)).toMatchObject({ failedCount: 1, endHistoryId: '159' });
  });

  it('treats 404 and P2002 as done, so the cursor still advances', async () => {
    seedMailbox();
    history([
      ['150', 'g-gone'],
      ['160', 'g-dupe'],
    ]);
    db.messages.push({ id: 'm-x', mailboxId: 'mb-paul', externalMessageId: 'g-other' });
    gmailApi.messagesGet.mockImplementation(async ({ id: msgId }: Row) => {
      if (msgId === 'g-gone') throw gmailError(404, 'Requested entity was not found.');
      db.messages.push({ id: 'm-dupe', mailboxId: 'mb-paul', externalMessageId: 'g-dupe' });
      return gmailMessage('g-dupe');
    });

    await syncIncremental('mb-paul');

    expect(db.mailboxes[0]!.lastHistoryId).toBe('200');
  });

  it('stops holding the cursor for a message that has failed 3 times', async () => {
    seedMailbox();
    db.tombstones.push({
      mailboxId: 'mb-paul',
      externalMessageId: 'g-bad',
      reason: 'FAILED',
      attempts: 2,
      updatedAt: new Date(),
    });
    history([['160', 'g-bad']]);
    gmailApi.messagesGet.mockRejectedValueOnce(gmailError(500, 'Backend Error'));

    await syncIncremental('mb-paul');

    expect(db.tombstones[0]!.attempts).toBe(3);
    expect(db.mailboxes[0]!.lastHistoryId).toBe('200');
  });
});

describe('processWebhook dedupe (L2)', () => {
  function push(historyId: string) {
    return {
      message: {
        data: Buffer.from(JSON.stringify({ emailAddress: OWNER, historyId })).toString('base64'),
      },
    };
  }

  it('skips a push whose historyId is not newer than the stored cursor', async () => {
    seedMailbox({ lastHistoryId: '500' });
    await processWebhook(push('500'));
    await processWebhook(push('420'));
    expect(gmailApi.historyList).not.toHaveBeenCalled();
    expect(events('WEBHOOK_STALE_SKIPPED')).toHaveLength(2);
  });

  it('syncs a push with a newer historyId', async () => {
    seedMailbox({ lastHistoryId: '500' });
    gmailApi.historyList.mockResolvedValueOnce({ data: { historyId: '510', history: [] } });
    await processWebhook(push('510'));
    expect(gmailApi.historyList).toHaveBeenCalledTimes(1);
    expect(db.mailboxes[0]!.lastHistoryId).toBe('510');
    expect(events('MAILBOX_SYNCED_INCREMENTAL')).toHaveLength(1);
  });

  it('ignores pushes for a disconnected mailbox', async () => {
    seedMailbox({ isActive: false, lastHistoryId: '1' });
    await processWebhook(push('510'));
    expect(gmailApi.historyList).not.toHaveBeenCalled();
  });
});

describe('duplicate live-draft race (L3)', () => {
  it('two concurrent fetchAndStoreMessage runs on one thread produce exactly one draft', async () => {
    seedMailbox();
    // Webhook (history) and reconcile (list) each pick up a different new
    // message on the same thread at the same time.
    gmailApi.historyList.mockResolvedValueOnce({
      data: { historyId: '200', history: [{ id: '150', messagesAdded: [{ message: { id: 'g-a' } }] }] },
    });
    gmailApi.messagesList.mockResolvedValueOnce({ data: { messages: [{ id: 'g-b' }] } });
    gmailApi.messagesGet.mockImplementation(async ({ id: msgId }: Row) =>
      gmailMessage(msgId as string, { at: msgId === 'g-a' ? '2026-10-22T10:00:00Z' : '2026-10-22T10:01:00Z' })
    );

    // Barrier: both runs pass the existing-draft check before either inserts.
    let release!: () => void;
    const bothClassifying = new Promise<void>((r) => (release = r));
    let calls = 0;
    claude.classifyReply.mockImplementation(async () => {
      if (++calls === 2) release();
      await bothClassifying;
      return interested();
    });

    await Promise.all([syncIncremental('mb-paul'), reconcileMailbox('mb-paul')]);

    expect(claude.generateHandoffDraftReply).toHaveBeenCalledTimes(2);
    expect(db.drafts.filter(isLive)).toHaveLength(1);
    expect(events('DRAFT_CREATED')).toHaveLength(1);
    expect(events('DRAFT_SKIPPED_DUPLICATE')).toHaveLength(1);
    expect(events('MESSAGE_PROCESSING_FAILED')).toHaveLength(0);
    expect(db.messages.every((m) => m.processingState === 'PROCESSED')).toBe(true);
  });
});

describe('sweepStuckMessages (M3)', () => {
  function stuck(overrides: Row = {}): Row {
    const thread = { id: 'thread-1', mailboxId: 'mb-paul', externalThreadId: 'gthread-1', subject: 'Re: Role', candidateId: null, lastMessageAt: new Date() };
    if (!db.threads.some((t) => t.id === thread.id)) db.threads.push(thread);
    const row = {
      id: `m-${db.messages.length + 1}`,
      threadId: 'thread-1',
      mailboxId: 'mb-paul',
      externalMessageId: `g-${db.messages.length + 1}`,
      fromAddress: CANDIDATE,
      fromName: 'Jane',
      toAddresses: JSON.stringify([OWNER]),
      subject: 'Re: Role',
      bodyText: 'Keen!',
      bodyHtml: null,
      receivedAt: new Date(Date.now() - 60 * 60 * 1000),
      headers: JSON.stringify({ messageId: '<x@y>', inReplyTo: '', references: '', cc: '' }),
      processingState: 'STORED',
      attempts: 1,
      createdAt: new Date(Date.now() - 30 * 60 * 1000),
      ...overrides,
    };
    db.messages.push(row);
    return row;
  }

  it('re-classifies stuck STORED/FAILED inbound rows and marks them PROCESSED', async () => {
    seedMailbox();
    const a = stuck();
    const b = stuck({ processingState: 'FAILED' });

    const result = await sweepStuckMessages();

    expect(result).toMatchObject({ found: 2, processed: 2, failed: 0 });
    expect(claude.classifyReply).toHaveBeenCalledTimes(2);
    expect(a).toMatchObject({ processingState: 'PROCESSED', attempts: 2 });
    expect(b).toMatchObject({ processingState: 'PROCESSED', attempts: 2 });
    expect(db.drafts.filter(isLive)).toHaveLength(1);
  });

  it('leaves recent rows (possibly still in flight) alone', async () => {
    seedMailbox();
    stuck({ createdAt: new Date() });
    const result = await sweepStuckMessages();
    expect(result.found).toBe(0);
    expect(claude.classifyReply).not.toHaveBeenCalled();
  });

  it('marks the row FAILED and logs once attempts hit the cap', async () => {
    seedMailbox();
    const row = stuck({ processingState: 'FAILED', attempts: 2 });
    const { prisma } = await import('../../src/db/client');
    (prisma.candidate.findUnique as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'));

    const result = await sweepStuckMessages();

    expect(result).toMatchObject({ found: 1, processed: 0, failed: 1 });
    expect(row).toMatchObject({ processingState: 'FAILED', attempts: 3 });
    expect(events('MESSAGE_PROCESSING_ABANDONED')).toHaveLength(1);
  });

  it('skips rows on NEEDS_REAUTH or inactive mailboxes', async () => {
    seedMailbox({ authStatus: 'NEEDS_REAUTH' });
    stuck();
    const result = await sweepStuckMessages();
    expect(result.processed).toBe(0);
    expect(claude.classifyReply).not.toHaveBeenCalled();
  });
});

describe('stopMailboxWatch (L4)', () => {
  it('calls users.stop and clears watchExpiry', async () => {
    seedMailbox({ watchExpiry: new Date('2026-10-29T00:00:00Z') });
    gmailApi.stop.mockResolvedValueOnce({});
    await stopMailboxWatch('mb-paul');
    expect(gmailApi.stop).toHaveBeenCalledWith({ userId: 'me' });
    expect(db.mailboxes[0]!.watchExpiry).toBeNull();
    expect(events('GMAIL_WATCH_STOPPED')).toHaveLength(1);
  });

  it('is best-effort: a Gmail error is logged, not thrown', async () => {
    seedMailbox();
    gmailApi.stop.mockRejectedValueOnce(gmailError(500, 'Backend Error'));
    await expect(stopMailboxWatch('mb-paul')).resolves.toBeUndefined();
    expect(events('GMAIL_WATCH_STOP_FAILED')).toHaveLength(1);
  });
});
