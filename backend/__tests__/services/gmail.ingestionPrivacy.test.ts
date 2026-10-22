// Audit B6 / H8: non-candidate mail is stored as metadata only.
//
// fetchAndStoreMessage runs against a fake Gmail client and the Prisma mock;
// classifyReply is stubbed so no Claude call is made.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

const { classifyReply } = vi.hoisted(() => ({ classifyReply: vi.fn() }));
vi.mock('../../src/services/claude.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/claude.service')>(
    '../../src/services/claude.service'
  );
  return { ...actual, classifyReply };
});
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { fetchAndStoreMessage, isInternalOnlyMessage } from '../../src/services/gmail.service';
import type { Mailbox } from '@prisma/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const MAILBOX = { id: 'mb-1', emailAddress: 'recruiter@archive.com' } as unknown as Mailbox;

function gmailWith(opts: { from: string; to: string; cc?: string; text?: string }) {
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  return {
    users: {
      messages: {
        get: vi.fn().mockResolvedValue({
          data: {
            threadId: 'ext-thread-1',
            internalDate: String(Date.parse('2026-10-20T10:00:00Z')),
            payload: {
              mimeType: 'multipart/alternative',
              headers: [
                { name: 'From', value: opts.from },
                { name: 'To', value: opts.to },
                ...(opts.cc ? [{ name: 'Cc', value: opts.cc }] : []),
                { name: 'Subject', value: 'Hello' },
                { name: 'Message-ID', value: '<m1@x>' },
              ],
              parts: [
                { mimeType: 'text/plain', body: { data: b64(opts.text ?? 'secret body text') } },
                { mimeType: 'text/html', body: { data: b64('<p>secret body html</p>') } },
              ],
            },
          },
        }),
      },
    },
  } as never;
}

function createdData() {
  return (mockPrisma.emailMessage.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
}

function scrubCalls() {
  return mockPrisma.emailMessage.updateMany.mock.calls.filter(([a]) => {
    const d = (a as { data: Record<string, unknown> }).data;
    return d.bodyText === null && d.bodyHtml === null;
  });
}

describe('isInternalOnlyMessage', () => {
  it.each([
    [{ fromAddress: 'a@archive.com', toAddresses: ['B <b@archive.com>'], cc: '' }, true],
    [{ fromAddress: 'a@archive.com', toAddresses: [], cc: '' }, true],
    [{ fromAddress: 'a@archive.com', toAddresses: ['b@archive.com'], cc: 'Cand <c@gmail.com>' }, false],
    [{ fromAddress: 'a@archive.com', toAddresses: ['c@gmail.com'], cc: '' }, false],
    [{ fromAddress: 'c@gmail.com', toAddresses: ['a@archive.com'], cc: '' }, false],
    [{ fromAddress: 'a@archive.com.evil.io', toAddresses: ['a@archive.com'], cc: '' }, false],
    [{ fromAddress: 'a@archive.com', toAddresses: ['"Doe, Jane" <jane@archive.com>'], cc: '' }, true],
  ])('%j → %s', (msg, expected) => {
    expect(
      isInternalOnlyMessage({ fromAddress: msg.fromAddress, toAddresses: msg.toAddresses, headers: { cc: msg.cc } })
    ).toBe(expected);
  });
});

describe('fetchAndStoreMessage body persistence (H8)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    classifyReply.mockReset();
    mockPrisma.emailMessage.findUnique.mockResolvedValue(null);
    mockPrisma.emailMessage.create.mockResolvedValue({ id: 'row-1' });
    mockPrisma.emailMessage.update.mockResolvedValue({});
    mockPrisma.emailMessage.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.emailMessage.findMany.mockResolvedValue([]);
    mockPrisma.emailDraft.findFirst.mockResolvedValue(null);
    mockPrisma.candidate.findUnique.mockResolvedValue(null);
  });

  function thread(candidateId: string | null) {
    mockPrisma.emailThread.upsert.mockResolvedValueOnce({
      id: 'thread-1',
      mailboxId: 'mb-1',
      subject: 'Hello',
      candidateId,
    });
  }

  it('stores internal-only inbound mail on an unlinked thread as metadata only and skips Claude', async () => {
    thread(null);
    await fetchAndStoreMessage(
      gmailWith({ from: 'Colleague <colleague@archive.com>', to: 'recruiter@archive.com' }),
      MAILBOX,
      'msg-1'
    );
    const data = createdData();
    expect(data.bodyText).toBeNull();
    expect(data.bodyHtml).toBeNull();
    expect(data.subject).toBe('Hello');
    expect(data.fromAddress).toBe('colleague@archive.com');
    expect(classifyReply).not.toHaveBeenCalled();
  });

  it('stores internal-only outbound mail on an unlinked thread as metadata only', async () => {
    thread(null);
    await fetchAndStoreMessage(
      gmailWith({ from: 'recruiter@archive.com', to: 'Boss <boss@archive.com>' }),
      MAILBOX,
      'msg-2'
    );
    expect(createdData().bodyText).toBeNull();
    expect(createdData().bodyHtml).toBeNull();
  });

  it('keeps the body of outbound mail to an external address (outreach context)', async () => {
    thread(null);
    await fetchAndStoreMessage(
      gmailWith({ from: 'recruiter@archive.com', to: 'cand@gmail.com' }),
      MAILBOX,
      'msg-3'
    );
    expect(createdData().bodyText).toBe('secret body text');
  });

  it('keeps bodies on candidate-linked threads, even for internal-only mail', async () => {
    thread('cand-1');
    await fetchAndStoreMessage(
      gmailWith({ from: 'colleague@archive.com', to: 'recruiter@archive.com' }),
      MAILBOX,
      'msg-4'
    );
    expect(createdData().bodyText).toBe('secret body text');
    expect(scrubCalls()).toHaveLength(0);
  });

  it('scrubs the body of external inbound mail classified NOT_RECRUITING_RELATED on an unlinked thread', async () => {
    thread(null);
    classifyReply.mockResolvedValueOnce({
      classification: 'NEUTRAL',
      messageType: 'NOT_RECRUITING_RELATED',
      needsReview: false,
      confidence: 0.95,
      role: null,
    });
    await fetchAndStoreMessage(
      gmailWith({ from: 'Vendor <sales@vendor.io>', to: 'recruiter@archive.com' }),
      MAILBOX,
      'msg-5'
    );

    expect(classifyReply).toHaveBeenCalledTimes(1);
    const scrubs = scrubCalls();
    expect(scrubs).toHaveLength(1);
    expect((scrubs[0][0] as { where: unknown }).where).toEqual({
      externalMessageId: 'msg-5',
      threadId: 'thread-1',
      thread: { candidateId: null },
    });
  });

  it('the scrub only matches while the thread is still unlinked (linked threads keep bodies)', async () => {
    thread(null);
    classifyReply.mockResolvedValueOnce({
      classification: 'NEUTRAL',
      messageType: 'NOT_RECRUITING_RELATED',
      needsReview: false,
      confidence: 0.95,
      role: null,
    });
    await fetchAndStoreMessage(
      gmailWith({ from: 'cand@gmail.com', to: 'recruiter@archive.com' }),
      MAILBOX,
      'msg-6'
    );
    // A thread linked by classification (or concurrently) fails this filter in
    // Postgres, so its body is kept.
    const where = (scrubCalls()[0][0] as { where: { thread: unknown } }).where;
    expect(where.thread).toEqual({ candidateId: null });
  });

  it('keeps the body when classification is deferred (bulk resync context; retention job covers it)', async () => {
    thread(null);
    await fetchAndStoreMessage(
      gmailWith({ from: 'cand@gmail.com', to: 'recruiter@archive.com' }),
      MAILBOX,
      'msg-7',
      { skipClassification: true }
    );
    expect(createdData().bodyText).toBe('secret body text');
    expect(scrubCalls()).toHaveLength(0);
  });
});
