// POST /api/emails/threads/:id/draft (manual generate) and
// POST /api/drafts/:id/regenerate — classification branching (M5), RFC
// threading headers (M13) and the hand-off fallback template (L12).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { classifyReply, generateDraftReply, generateHandoffDraftReply, fetchMailboxSignature, fetchExamplesForMailbox } =
  vi.hoisted(() => ({
    classifyReply: vi.fn(),
    generateDraftReply: vi.fn(),
    generateHandoffDraftReply: vi.fn(),
    fetchMailboxSignature: vi.fn(),
    fetchExamplesForMailbox: vi.fn(),
  }));

vi.mock('../../src/services/claude.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/claude.service')>(
    '../../src/services/claude.service'
  );
  return { ...actual, classifyReply, generateDraftReply, generateHandoffDraftReply };
});

vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return { ...actual, fetchMailboxSignature, fetchExamplesForMailbox };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;
const AUTH = bearer('test-user-1');

const handoffMailbox = {
  id: 'mb-1',
  emailAddress: 'aaron@archive.com',
  displayName: 'Aaron Rampersad',
  provider: 'GMAIL',
  isActive: true,
};
const candidate = { id: 'cand-1', name: 'Jane Doe', email: 'jane@example.com', role: 'Engineer' };
const inbound = {
  id: 'msg-2',
  externalMessageId: '18c2f0a9b1d2e3f4',
  fromAddress: 'jane@example.com',
  fromName: 'Jane Doe',
  subject: 'Re: opportunity',
  bodyText: 'Sounds interesting!',
  bodyHtml: null,
  receivedAt: new Date('2026-10-01T00:00:00Z'),
  headers: JSON.stringify({
    messageId: '<CAB123@mail.gmail.com>',
    references: '<root@mail.gmail.com>',
  }),
};
const outbound = {
  id: 'msg-1',
  externalMessageId: '18c2f0a9b1d2e3f0',
  fromAddress: 'aaron@archive.com',
  fromName: 'Aaron',
  subject: 'opportunity',
  bodyText: 'Hi Jane, interested?',
  bodyHtml: null,
  receivedAt: new Date('2026-09-30T00:00:00Z'),
  headers: '{}',
};

function classification(overrides: Record<string, unknown> = {}) {
  return {
    classification: 'INTERESTED',
    messageType: 'FOLLOWUP',
    needsReview: false,
    confidence: 0.9,
    reasoning: 'ok',
    role: 'Engineer',
    ...overrides,
  };
}

function loggedEvents(): Array<{ event: string; level: string; details: Record<string, unknown> }> {
  return mockPrisma.systemLog.create.mock.calls.map(([arg]) => {
    const d = (arg as { data: { event: string; level: string; details: string } }).data;
    return { event: d.event, level: d.level, details: JSON.parse(d.details ?? '{}') };
  });
}

describe('POST /api/emails/threads/:id/draft', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    for (const m of [classifyReply, generateDraftReply, generateHandoffDraftReply, fetchMailboxSignature, fetchExamplesForMailbox]) {
      m.mockReset();
    }
    fetchMailboxSignature.mockResolvedValue(null);
    fetchExamplesForMailbox.mockResolvedValue([]);
    mockPrisma.emailThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      subject: 'opportunity',
      externalThreadId: 'ext-1',
      messages: [outbound, inbound],
      candidate,
      mailbox: handoffMailbox,
      drafts: [],
    });
    mockPrisma.mailbox.findUnique.mockResolvedValue({ displayName: 'Sofia Delgado' });
    mockPrisma.emailDraft.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'draft-new', ...(data as object) }));
    app = await loadApp();
  });

  it('threads on the inbound RFC Message-ID, not the Gmail API id', async () => {
    classifyReply.mockResolvedValueOnce(classification());
    generateHandoffDraftReply.mockResolvedValueOnce({ subject: 'Re: opportunity', bodyText: 'Hi', bodyHtml: '<div>Hi</div>' });

    await request(app).post('/api/emails/threads/thread-1/draft').set('Authorization', AUTH).expect(201);

    const data = mockPrisma.emailDraft.create.mock.calls[0]![0].data;
    expect(data.inReplyToMessageId).toBe('<CAB123@mail.gmail.com>');
    expect(data.referencesHeader).toBe('<root@mail.gmail.com> <CAB123@mail.gmail.com>');
  });

  it('refuses to draft when the classifier fell back (Claude unavailable)', async () => {
    classifyReply.mockResolvedValueOnce(
      classification({ classification: 'NEUTRAL', confidence: 0, needsReview: true, isFallback: true })
    );

    const res = await request(app).post('/api/emails/threads/thread-1/draft').set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(mockPrisma.emailDraft.create).not.toHaveBeenCalled();
    expect(generateHandoffDraftReply).not.toHaveBeenCalled();
  });

  it('writes a normal reply (not a hand-off) for a NOT_INTERESTED candidate on a hand-off inbox', async () => {
    classifyReply.mockResolvedValueOnce(classification({ classification: 'NOT_INTERESTED', confidence: 0.95 }));
    generateDraftReply.mockResolvedValueOnce({ subject: 'Re: opportunity', bodyText: 'Thanks anyway', bodyHtml: '<div>x</div>' });

    await request(app).post('/api/emails/threads/thread-1/draft').set('Authorization', AUTH).expect(201);

    expect(generateHandoffDraftReply).not.toHaveBeenCalled();
    expect(generateDraftReply).toHaveBeenCalledWith(
      expect.objectContaining({ classification: 'NOT_INTERESTED' }),
      expect.anything()
    );
    expect(mockPrisma.emailDraft.create.mock.calls[0]![0].data.classification).toBe('NOT_INTERESTED');
  });

  it('logs DRAFT_FALLBACK_TEMPLATE and uses the CC first name when the hand-off generator fails', async () => {
    classifyReply.mockResolvedValueOnce(classification());
    generateHandoffDraftReply.mockRejectedValueOnce(new Error('Invalid draft reply: schema mismatch'));
    mockPrisma.mailbox.findUnique.mockResolvedValue({ displayName: 'Maria Lopez' });

    await request(app).post('/api/emails/threads/thread-1/draft').set('Authorization', AUTH).expect(201);

    const data = mockPrisma.emailDraft.create.mock.calls[0]![0].data;
    expect(data.bodyText).toContain("I'm looping in Maria");
    expect(data.bodyText).not.toContain('Sofia');
    const fallback = loggedEvents().find((e) => e.event === 'DRAFT_FALLBACK_TEMPLATE');
    expect(fallback?.level).toBe('WARN');
    expect(fallback?.details).toMatchObject({ threadId: 'thread-1', via: 'manual_generate' });
    const created = loggedEvents().find((e) => e.event === 'DRAFT_CREATED');
    expect(created?.details.template).toBe('handoff_fallback_template');
  });
});

describe('POST /api/emails/threads/:id/draft — triage + metadata (M17, M14)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    for (const m of [classifyReply, generateDraftReply, generateHandoffDraftReply, fetchMailboxSignature, fetchExamplesForMailbox]) {
      m.mockReset();
    }
    fetchMailboxSignature.mockResolvedValue(null);
    fetchExamplesForMailbox.mockResolvedValue([]);
    mockPrisma.emailThread.findUnique.mockResolvedValue({
      id: 'thread-1',
      subject: 'opportunity',
      externalThreadId: 'ext-1',
      messages: [outbound, inbound],
      candidate,
      mailbox: handoffMailbox,
      drafts: [],
    });
    mockPrisma.mailbox.findUnique.mockResolvedValue({ displayName: 'Sofia Delgado' });
    mockPrisma.emailDraft.create.mockImplementation(async ({ data }: { data: unknown }) => ({ id: 'draft-new', ...(data as object) }));
    app = await loadApp();
  });

  it("uses the recruiter's triage decision instead of re-classifying", async () => {
    generateHandoffDraftReply.mockResolvedValueOnce({ subject: 'Re: opportunity', bodyText: 'Hi', bodyHtml: '<div>Hi</div>' });

    await request(app)
      .post('/api/emails/threads/thread-1/draft')
      .set('Authorization', AUTH)
      .send({ classification: 'INTERESTED' })
      .expect(201);

    expect(classifyReply).not.toHaveBeenCalled();
    expect(generateHandoffDraftReply).toHaveBeenCalled();
    const data = mockPrisma.emailDraft.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ classification: 'INTERESTED', confidence: 1 });
    const created = loggedEvents().find((e) => e.event === 'DRAFT_CREATED');
    expect(created?.details.via).toBe('triage');
  });

  it('rejects an unknown classification override', async () => {
    const res = await request(app)
      .post('/api/emails/threads/thread-1/draft')
      .set('Authorization', AUTH)
      .send({ classification: 'REPLIED' });
    expect(res.status).toBe(400);
  });

  it('stores model, prompt version and token usage on the draft', async () => {
    classifyReply.mockResolvedValueOnce(classification());
    generateHandoffDraftReply.mockResolvedValueOnce({
      subject: 'Re: opportunity',
      bodyText: 'Hi',
      bodyHtml: '<div>Hi</div>',
      meta: {
        model: 'claude-sonnet-4-6',
        promptVersion: 'handoff-2026-10-22',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    });

    await request(app).post('/api/emails/threads/thread-1/draft').set('Authorization', AUTH).expect(201);

    const data = mockPrisma.emailDraft.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      model: 'claude-sonnet-4-6',
      promptVersion: 'handoff-2026-10-22',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
  });
});

describe('POST /api/drafts/:id/regenerate (M5)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    for (const m of [classifyReply, generateDraftReply, generateHandoffDraftReply, fetchMailboxSignature, fetchExamplesForMailbox]) {
      m.mockReset();
    }
    fetchMailboxSignature.mockResolvedValue(null);
    fetchExamplesForMailbox.mockResolvedValue([]);
    mockPrisma.emailDraft.findUnique.mockResolvedValue({
      id: 'draft-1',
      status: 'PENDING',
      inReplyToMessageId: null,
      updatedAt: new Date('2026-10-02T00:00:00Z'),
      thread: { id: 'thread-1', subject: 'opportunity', candidate, mailbox: handoffMailbox },
    });
    mockPrisma.emailMessage.findMany.mockResolvedValue([inbound, outbound]);
    app = await loadApp();
  });

  it('keeps the existing draft and returns 502 when the classifier fell back', async () => {
    classifyReply.mockResolvedValueOnce(
      classification({ classification: 'NEUTRAL', confidence: 0, needsReview: true, isFallback: true })
    );

    const res = await request(app).post('/api/drafts/draft-1/regenerate').set('Authorization', AUTH);

    expect(res.status).toBe(502);
    expect(mockPrisma.emailDraft.update).not.toHaveBeenCalled();
    expect(generateDraftReply).not.toHaveBeenCalled();
  });
});
