import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUTH = bearer('test-user-1');

function msg(over: Partial<Record<string, unknown>>) {
  return {
    id: 'm',
    threadId: 't-1',
    mailboxId: 'mb-paul',
    externalMessageId: 'g-1',
    fromAddress: 'paul.b@archive.com',
    toAddresses: '["bob@x.com"]',
    subject: 'Role at Archive',
    receivedAt: new Date('2026-10-03T10:00:00Z'),
    processingState: 'PROCESSED',
    ...over,
  };
}

const MAILBOXES = [
  { id: 'mb-paul', emailAddress: 'paul.b@archive.com' },
  { id: 'mb-ethan', emailAddress: 'ethan@archive.com' },
];

describe('GET /api/lookup', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    mockPrisma.candidate.findFirst.mockResolvedValue(null);
    mockPrisma.emailMessage.findMany.mockResolvedValue([]);
    mockPrisma.mailbox.findMany.mockResolvedValue(MAILBOXES);
    mockPrisma.emailDraft.findMany.mockResolvedValue([]);
    mockPrisma.systemLog.findMany.mockResolvedValue([]);
    app = await loadApp();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/lookup?email=bob@x.com');
    expect(res.status).toBe(401);
    expect(mockPrisma.candidate.findFirst).not.toHaveBeenCalled();
  });

  it.each([['missing', ''], ['garbage', '?email=not-an-email'], ['repeated', '?email=a@b.com&email=c@d.com']])(
    'returns 400 for a %s email',
    async (_label, query) => {
      const res = await request(app).get(`/api/lookup${query}`).set('Authorization', AUTH);
      expect(res.status).toBe(400);
      expect(mockPrisma.emailMessage.findMany).not.toHaveBeenCalled();
    }
  );

  it('UNKNOWN when nothing matches, with an empty integrations object', async () => {
    const res = await request(app)
      .get('/api/lookup?email=arron@arrongould.com')
      .set('Authorization', AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe('UNKNOWN');
    expect(res.body.data.email).toBe('arron@arrongould.com');
    expect(res.body.data.candidate).toBeNull();
    expect(res.body.data.integrations).toEqual({});
    expect(res.body.data.messages).toMatchObject({ inbound: 0, outbound: 0 });
  });

  it('normalizes the email and queries case-insensitively with bounded takes', async () => {
    await request(app).get('/api/lookup?email=%20Bob@X.COM%20').set('Authorization', AUTH);

    const candArgs = mockPrisma.candidate.findFirst.mock.calls[0]?.[0];
    expect(candArgs.where.email).toEqual({ equals: 'bob@x.com', mode: 'insensitive' });

    const msgArgs = mockPrisma.emailMessage.findMany.mock.calls[0]?.[0];
    expect(msgArgs.where.OR).toEqual([
      { fromAddress: { equals: 'bob@x.com', mode: 'insensitive' } },
      { toAddresses: { contains: 'bob@x.com', mode: 'insensitive' } },
    ]);
    expect(msgArgs.take).toBeLessThanOrEqual(500);
    // metadata only — bodies are never selected
    expect(msgArgs.select.bodyText).toBeUndefined();
    expect(msgArgs.select.bodyHtml).toBeUndefined();
  });

  it('CONTACTED_NO_REPLY when we only emailed them (toAddresses JSON match)', async () => {
    mockPrisma.emailMessage.findMany.mockResolvedValueOnce([
      msg({ toAddresses: '["\\"Bob\\" <Bob@x.com>"]' }),
    ]);
    const res = await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);
    expect(res.body.data.verdict).toBe('CONTACTED_NO_REPLY');
    expect(res.body.data.summary).toMatch(/^We emailed them from paul\.b@ on 3 Oct/);
    expect(res.body.data.messages).toMatchObject({
      inbound: 0,
      outbound: 1,
      latestSubject: 'Role at Archive',
      mailboxes: [{ id: 'mb-paul', emailAddress: 'paul.b@archive.com' }],
    });
  });

  it('ignores substring false positives from the SQL prefilter', async () => {
    mockPrisma.emailMessage.findMany.mockResolvedValueOnce([
      msg({ toAddresses: '["jimbob@x.com"]' }),
    ]);
    const res = await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);
    expect(res.body.data.verdict).toBe('UNKNOWN');
  });

  it('REPLIED_NOT_CANDIDATE with the SystemLog skip reason in the last 90 days', async () => {
    mockPrisma.emailMessage.findMany.mockResolvedValueOnce([
      msg({}),
      msg({
        id: 'm2',
        externalMessageId: 'g-2',
        fromAddress: 'BOB@x.com',
        toAddresses: '["paul.b@archive.com"]',
        receivedAt: new Date('2026-10-05T10:00:00Z'),
      }),
    ]);
    mockPrisma.systemLog.findMany.mockResolvedValueOnce([
      { event: 'MESSAGE_SKIPPED_NOT_RECRUITING', createdAt: new Date('2026-10-05T10:01:00Z') },
    ]);
    const res = await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);

    expect(res.body.data.verdict).toBe('REPLIED_NOT_CANDIDATE');
    expect(res.body.data.summary).toMatch(/skipped as not recruiting-related$/);
    expect(res.body.data.skipped.reasons).toEqual(['NOT_RECRUITING']);

    const logArgs = mockPrisma.systemLog.findMany.mock.calls[0]?.[0];
    expect(logArgs.where.event.in).toEqual(
      expect.arrayContaining(['MESSAGE_SKIPPED_NOT_RECRUITING', 'MESSAGE_SKIPPED_NO_ROLE'])
    );
    const since = logArgs.where.createdAt.gte as Date;
    const days = (Date.now() - since.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(90);
    // skip logs carry the Gmail message id, not the address
    expect(logArgs.where.OR).toEqual([{ details: { contains: 'g-2' } }]);
    expect(logArgs.take).toBeLessThanOrEqual(50);
  });

  it('REPLIED_NOT_CANDIDATE flags internal/automated filtering via processingState', async () => {
    mockPrisma.emailMessage.findMany.mockResolvedValueOnce([
      msg({ fromAddress: 'bob@x.com', toAddresses: '["ethan@archive.com"]', mailboxId: 'mb-ethan', processingState: 'SKIPPED' }),
    ]);
    const res = await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);
    expect(res.body.data.verdict).toBe('REPLIED_NOT_CANDIDATE');
    expect(res.body.data.skipped.reasons).toEqual(['FILTERED']);
    expect(res.body.data.summary).toMatch(/^They wrote to ethan@ on 3 Oct/);
  });

  it('skips the SystemLog query when there is no inbound mail', async () => {
    await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);
    expect(mockPrisma.systemLog.findMany).not.toHaveBeenCalled();
  });

  it('CANDIDATE with candidate details, first mailbox and draft counts', async () => {
    mockPrisma.candidate.findFirst.mockResolvedValueOnce({
      id: 'cand-1',
      name: 'Bob Builder',
      email: 'bob@x.com',
      status: 'INTERESTED',
      role: 'Senior Engineer',
      company: 'X',
      title: null,
      notes: 'private recruiter note',
      mailboxId: 'mb-ethan',
      firstMailboxId: 'mb-paul',
      repliedAt: null,
      lastInboundAt: new Date('2026-10-05T10:00:00Z'),
      lastOutboundAt: null,
      createdAt: new Date('2026-10-05T10:00:00Z'),
      mailbox: { id: 'mb-ethan', emailAddress: 'ethan@archive.com' },
      threads: [{ id: 't-1' }, { id: 't-2' }],
    });
    mockPrisma.emailDraft.findMany.mockResolvedValueOnce([
      { id: 'd-3', status: 'PENDING', threadId: 't-2', createdAt: new Date('2026-10-06T00:00:00Z') },
      { id: 'd-2', status: 'SENT', threadId: 't-1', createdAt: new Date('2026-10-04T00:00:00Z') },
      { id: 'd-1', status: 'DISCARDED', threadId: 't-1', createdAt: new Date('2026-10-03T00:00:00Z') },
    ]);
    const res = await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);

    expect(res.body.data.verdict).toBe('CANDIDATE');
    expect(res.body.data.summary).toBe('Candidate (Interested) for Senior Engineer — via ethan@');
    expect(res.body.data.candidate).toMatchObject({
      id: 'cand-1',
      name: 'Bob Builder',
      status: 'INTERESTED',
      role: 'Senior Engineer',
      mailbox: { id: 'mb-ethan', emailAddress: 'ethan@archive.com' },
      firstMailbox: { id: 'mb-paul', emailAddress: 'paul.b@archive.com' },
      lastInboundAt: '2026-10-05T10:00:00.000Z',
    });
    expect(res.body.data.candidate.notes).toBeUndefined();
    expect(res.body.data.drafts).toEqual({
      total: 3,
      byStatus: { PENDING: 1, SENT: 1, DISCARDED: 1 },
      latest: { id: 'd-3', status: 'PENDING', threadId: 't-2', createdAt: '2026-10-06T00:00:00.000Z' },
    });
    const draftArgs = mockPrisma.emailDraft.findMany.mock.calls[0]?.[0];
    expect(draftArgs.where.threadId.in.sort()).toEqual(['t-1', 't-2']);
    expect(draftArgs.select.bodyText).toBeUndefined();
  });

  it('does a fixed number of queries (no N+1) regardless of message count', async () => {
    mockPrisma.emailMessage.findMany.mockResolvedValueOnce(
      Array.from({ length: 40 }, (_, i) =>
        msg({ id: `m${i}`, externalMessageId: `g-${i}`, fromAddress: 'bob@x.com', threadId: `t-${i}`, mailboxId: i % 2 ? 'mb-paul' : 'mb-ethan' })
      )
    );
    await request(app).get('/api/lookup?email=bob@x.com').set('Authorization', AUTH);
    expect(mockPrisma.mailbox.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailDraft.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.systemLog.findMany).toHaveBeenCalledTimes(1);
    const logArgs = mockPrisma.systemLog.findMany.mock.calls[0]?.[0];
    expect(logArgs.where.OR.length).toBeLessThanOrEqual(25);
  });
});
