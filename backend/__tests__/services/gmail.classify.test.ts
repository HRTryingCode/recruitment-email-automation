import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

const { classifyReply, generateHandoffDraftReply } = vi.hoisted(() => ({
  classifyReply: vi.fn(),
  generateHandoffDraftReply: vi.fn(),
}));
vi.mock('../../src/services/claude.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/claude.service')>();
  return { ...actual, classifyReply, generateHandoffDraftReply };
});

// H2: new candidates get a background Lever check.
const { scheduleLeverRefresh } = vi.hoisted(() => ({ scheduleLeverRefresh: vi.fn() }));
vi.mock('../../src/services/leverRealtime.service', () => ({ scheduleLeverRefresh }));
// H5: and a background Gem lookup (cache for the Add to Lever dialog).
const { scheduleGemEnrichment } = vi.hoisted(() => ({ scheduleGemEnrichment: vi.fn() }));
vi.mock('../../src/services/gemEnrichment.service', () => ({ scheduleGemEnrichment }));

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  classifyAndDraft,
  parseGmailMessage,
  stripQuotedReply,
  recordOutboundMessage,
} from '../../src/services/gmail.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const mailbox = {
  id: 'mb-1',
  emailAddress: 'emaenza@archive.com',
  displayName: 'Ethan Maenza',
} as never;

function parsed(over: Partial<{ fromAddress: string; receivedAt: Date }> = {}) {
  return {
    externalMessageId: 'msg-2',
    threadId: 'gthread',
    subject: 'Re: Role',
    fromAddress: over.fromAddress ?? 'cand@example.com',
    fromName: 'Cand Idate',
    toAddresses: ['emaenza@archive.com'],
    bodyText: 'body',
    bodyHtml: '',
    receivedAt: over.receivedAt ?? new Date('2026-10-10T10:00:00Z'),
    headers: { messageId: '<m2@x>', inReplyTo: '', references: '', cc: '' },
  };
}

function classification(over: Record<string, unknown>) {
  return {
    classification: 'NEUTRAL',
    messageType: 'FOLLOWUP',
    needsReview: false,
    confidence: 0.95,
    reasoning: '',
    role: 'Influencer Marketing Manager',
    ...over,
  };
}

const outreach = {
  externalMessageId: 'msg-1',
  fromAddress: 'emaenza@archive.com',
  fromName: 'Ethan',
  bodyText: 'Hi, interested in a role?',
  bodyHtml: null,
  subject: 'Role',
  receivedAt: new Date('2026-10-01T00:00:00Z'),
};

function setup(opts: { existing?: Record<string, unknown> | null; messages?: unknown[]; thread?: Record<string, unknown> } = {}) {
  mockPrisma.candidate.findFirst.mockResolvedValue(opts.existing ?? null);
  mockPrisma.emailMessage.findMany.mockResolvedValue(opts.messages ?? [outreach]);
  mockPrisma.emailDraft.findFirst.mockResolvedValue({ id: 'live', status: 'PENDING' }); // stop before drafting
  mockPrisma.candidate.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
    id: 'cand-1',
    name: 'Cand Idate',
    role: null,
    ...args.create,
  }));
  mockPrisma.emailThread.update.mockResolvedValue({});
  return { id: 'th-1', candidateId: null, mailboxId: 'mb-1', subject: 'Role', ...(opts.thread ?? {}) } as never;
}

function upsertArgs() {
  return mockPrisma.candidate.upsert.mock.calls[0][0] as {
    where: { email: string };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  };
}

function loggedEvents(): string[] {
  return mockPrisma.systemLog.create.mock.calls.map((c) => (c[0] as { data: { event: string } }).data.event);
}

describe('classifyAndDraft — status + conversation state (H6, M12)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    classifyReply.mockReset();
  });

  it('a confident decline overrides INTERESTED', async () => {
    const thread = setup({ existing: { id: 'cand-1', email: 'cand@example.com', status: 'INTERESTED', role: 'X', lastInboundAt: null } });
    classifyReply.mockResolvedValue(classification({ classification: 'NOT_INTERESTED', confidence: 0.97 }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(upsertArgs().update.status).toBe('NOT_INTERESTED');
  });

  it('a NEUTRAL logistics reply does not downgrade INTERESTED', async () => {
    const thread = setup({ existing: { id: 'cand-1', email: 'cand@example.com', status: 'INTERESTED', role: 'X', lastInboundAt: null } });
    classifyReply.mockResolvedValue(classification({ classification: 'NEUTRAL', messageType: 'SCHEDULING' }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(upsertArgs().update.status).toBe('INTERESTED');
  });

  it('records lastInboundAt and firstMailboxId on a new candidate', async () => {
    const thread = setup();
    classifyReply.mockResolvedValue(classification({ classification: 'INTERESTED' }));
    const at = new Date('2026-10-10T10:00:00Z');
    await classifyAndDraft({ mailbox, thread, parsed: parsed({ receivedAt: at }) });
    expect(upsertArgs().create).toMatchObject({ lastInboundAt: at, firstMailboxId: 'mb-1', email: 'cand@example.com' });
  });

  it('never moves lastInboundAt backwards for an out-of-order message', async () => {
    const later = new Date('2026-10-20T00:00:00Z');
    const thread = setup({ existing: { id: 'cand-1', email: 'cand@example.com', status: 'NEUTRAL', role: 'X', lastInboundAt: later } });
    classifyReply.mockResolvedValue(classification({}));
    await classifyAndDraft({ mailbox, thread, parsed: parsed({ receivedAt: new Date('2026-10-10T00:00:00Z') }) });
    expect(upsertArgs().update.lastInboundAt).toEqual(later);
  });

  it('updates a legacy mixed-case row by its own spelling instead of duplicating it (M12)', async () => {
    const thread = setup({ existing: { id: 'cand-1', email: 'Cand@Example.com', status: 'NEUTRAL', role: 'X', lastInboundAt: null } });
    classifyReply.mockResolvedValue(classification({}));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(mockPrisma.candidate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: 'cand@example.com', mode: 'insensitive' } } })
    );
    expect(upsertArgs().where).toEqual({ email: 'Cand@Example.com' });
  });
});

describe('classifyAndDraft — Lever check on create (H2)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    classifyReply.mockReset();
    scheduleLeverRefresh.mockReset();
    scheduleGemEnrichment.mockReset();
  });

  it('schedules a Lever refresh for a newly created candidate', async () => {
    const thread = setup();
    classifyReply.mockResolvedValue(classification({ classification: 'INTERESTED' }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(scheduleLeverRefresh).toHaveBeenCalledTimes(1);
    expect(scheduleLeverRefresh).toHaveBeenCalledWith('cand-1', 'created');
  });

  it('schedules a background Gem lookup as the mailbox owner for a newly created candidate', async () => {
    const thread = setup();
    classifyReply.mockResolvedValue(classification({ classification: 'INTERESTED' }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(scheduleGemEnrichment).toHaveBeenCalledWith('cand-1', 'created', { mailboxEmail: mailbox.emailAddress });
  });

  it('does not schedule one for an existing candidate', async () => {
    const thread = setup({ existing: { id: 'cand-1', email: 'cand@example.com', status: 'NEUTRAL', role: 'X', lastInboundAt: null } });
    classifyReply.mockResolvedValue(classification({}));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(scheduleLeverRefresh).not.toHaveBeenCalled();
    expect(scheduleGemEnrichment).not.toHaveBeenCalled();
  });
});

describe('classifyAndDraft — NOT_RECRUITING_RELATED gate (M15)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    classifyReply.mockReset();
  });

  it('routes NOT_RECRUITING on an outreach thread to NEEDS_REVIEW instead of skipping', async () => {
    const thread = setup({ messages: [outreach] });
    classifyReply.mockResolvedValue(classification({ messageType: 'NOT_RECRUITING_RELATED', confidence: 0.99, role: null }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(upsertArgs().create.status).toBe('NEEDS_REVIEW');
    expect(loggedEvents()).toContain('NOT_RECRUITING_ROUTED_TO_REVIEW');
    expect(loggedEvents()).not.toContain('MESSAGE_SKIPPED_NOT_RECRUITING');
  });

  it('routes NOT_RECRUITING from a known candidate to review', async () => {
    const thread = setup({
      messages: [{ ...outreach, fromAddress: 'cand@example.com' }],
      existing: { id: 'cand-1', email: 'cand@example.com', status: 'NEUTRAL', role: 'X', lastInboundAt: null },
    });
    classifyReply.mockResolvedValue(classification({ messageType: 'NOT_RECRUITING_RELATED', confidence: 0.99 }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(upsertArgs().update.status).toBe('NEEDS_REVIEW');
  });

  it('routes an under-confident (0.8) NOT_RECRUITING to review', async () => {
    const thread = setup({ messages: [] });
    classifyReply.mockResolvedValue(classification({ messageType: 'NOT_RECRUITING_RELATED', confidence: 0.8, role: null }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(mockPrisma.candidate.upsert).toHaveBeenCalled();
    expect(loggedEvents()).not.toContain('MESSAGE_SKIPPED_NOT_RECRUITING');
  });

  it('still skips a confident NOT_RECRUITING on an unrelated inbound-only thread', async () => {
    const thread = setup({ messages: [] });
    classifyReply.mockResolvedValue(classification({ messageType: 'NOT_RECRUITING_RELATED', confidence: 0.95, role: null }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(mockPrisma.candidate.upsert).not.toHaveBeenCalled();
    expect(loggedEvents()).toContain('MESSAGE_SKIPPED_NOT_RECRUITING');
  });

  it('does not drop a known candidate follow-up just because it names no role', async () => {
    const thread = setup({
      thread: { candidateId: 'cand-1' },
      existing: { id: 'cand-1', email: 'cand@example.com', status: 'INTERESTED', role: 'X', lastInboundAt: null },
    });
    classifyReply.mockResolvedValue(classification({ role: null }));
    await classifyAndDraft({ mailbox, thread, parsed: parsed() });
    expect(mockPrisma.candidate.upsert).toHaveBeenCalled();
    expect(loggedEvents()).not.toContain('MESSAGE_SKIPPED_NO_ROLE');
  });
});

describe('parseGmailMessage (M12)', () => {
  it('lowercases the From address', () => {
    const out = parseGmailMessage('m1', {
      threadId: 't1',
      internalDate: '1760000000000',
      payload: { headers: [{ name: 'From', value: 'Jane Doe <Jane.Doe@Example.COM>' }] },
    });
    expect(out.fromAddress).toBe('jane.doe@example.com');
    expect(out.fromName).toBe('Jane Doe');
  });
});

describe('stripQuotedReply (L11)', () => {
  it('keeps only what the recruiter wrote', () => {
    const body = 'Sounds good, talk Tuesday!\n\nBest,\nSofia\n\nOn Mon, Oct 6, 2026 at 9:00 AM Jane <j@x.com> wrote:\n> earlier text';
    expect(stripQuotedReply(body)).toBe('Sounds good, talk Tuesday!\n\nBest,\nSofia');
  });
  it('handles ">" quoting and Outlook separators', () => {
    expect(stripQuotedReply('Yes!\n> quoted')).toBe('Yes!');
    expect(stripQuotedReply('Thanks\n-----Original Message-----\nFrom: x')).toBe('Thanks');
  });
});

describe('recordOutboundMessage (H6, M14)', () => {
  beforeEach(() => resetPrismaMock(mockPrisma));
  const at = new Date('2026-10-11T00:00:00Z');

  it('advances lastOutboundAt forward-only, even for the first outreach', async () => {
    mockPrisma.candidate.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.emailMessage.findFirst.mockResolvedValue(null);
    await recordOutboundMessage(mailbox, { id: 'th-1', candidateId: 'cand-1' }, at);
    expect(mockPrisma.candidate.updateMany).toHaveBeenCalledWith({
      where: { id: 'cand-1', OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: at } }] },
      data: { lastOutboundAt: at },
    });
    expect(mockPrisma.candidate.update).not.toHaveBeenCalled();
  });

  it('a reply to the candidate sets repliedAt and logs DRAFT_SUPERSEDED for discarded drafts', async () => {
    mockPrisma.candidate.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ id: 'in-1' });
    mockPrisma.candidate.update.mockResolvedValue({});
    mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 2 });
    await recordOutboundMessage(mailbox, { id: 'th-1', candidateId: 'cand-1' }, at);
    expect(mockPrisma.candidate.update).toHaveBeenCalledWith({ where: { id: 'cand-1' }, data: { repliedAt: at } });
    const superseded = mockPrisma.systemLog.create.mock.calls
      .map((c) => (c[0] as { data: { event: string; details: string } }).data)
      .find((d) => d.event === 'DRAFT_SUPERSEDED');
    expect(superseded).toBeDefined();
    expect(JSON.parse(superseded!.details)).toMatchObject({ reason: 'manual_reply', count: 2 });
  });

  it('a manual reply also cancels a SCHEDULED one-step send, but never an in-flight SENDING one (U0)', async () => {
    mockPrisma.candidate.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ id: 'in-1' });
    mockPrisma.candidate.update.mockResolvedValue({});
    mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 1 });
    await recordOutboundMessage(mailbox, { id: 'th-1', candidateId: 'cand-1' }, at);
    const where = mockPrisma.emailDraft.updateMany.mock.calls[0][0].where;
    expect(where.status.in).toContain('SCHEDULED');
    expect(where.status.in).not.toContain('SENDING');
  });

  it('does nothing for a thread with no candidate', async () => {
    await recordOutboundMessage(mailbox, { id: 'th-1', candidateId: null }, at);
    expect(mockPrisma.candidate.updateMany).not.toHaveBeenCalled();
  });
});

describe('classifyAndDraft — auto-drafted reply records AI body + evidence (U0)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    classifyReply.mockReset();
    generateHandoffDraftReply.mockReset();
  });

  it('stores aiBodyText, classificationReason and evidenceQuote on the new draft', async () => {
    const thread = setup();
    mockPrisma.emailDraft.findFirst.mockResolvedValue(null); // no live draft: go on to draft
    mockPrisma.emailDraft.create.mockResolvedValue({ id: 'd-new' });
    mockPrisma.mailbox.findUnique.mockResolvedValue(null);
    classifyReply.mockResolvedValueOnce(
      classification({ classification: 'INTERESTED', reason: 'Wants to talk', evidenceQuote: 'body' })
    );
    generateHandoffDraftReply.mockResolvedValueOnce({ subject: 'Re: Role', bodyText: 'Hi Cand', bodyHtml: '<div>Hi Cand</div>' });

    await classifyAndDraft({ mailbox, thread, parsed: parsed() });

    expect(mockPrisma.emailDraft.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.emailDraft.create.mock.calls[0][0].data;
    expect(data.aiBodyText).toBe(data.bodyText);
    expect(data).toMatchObject({ classificationReason: 'Wants to talk', evidenceQuote: 'body' });
  });
});
