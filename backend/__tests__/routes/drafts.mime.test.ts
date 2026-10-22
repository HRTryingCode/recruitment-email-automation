// End-to-end (route → real gmail.service.createDraft → raw MIME) tests for the
// draft review loop. Unlike drafts.test.ts, createDraft is NOT mocked here:
// only the googleapis boundary and prisma are faked, so assertions run against
// the exact RFC 2822 message we would hand to Gmail.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { draftsCreate, draftsSend, draftsDelete, sendAsList, anthropicCreate } = vi.hoisted(() => ({
  draftsCreate: vi.fn(),
  draftsSend: vi.fn(),
  draftsDelete: vi.fn(),
  sendAsList: vi.fn(),
  anthropicCreate: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    messages = { create: anthropicCreate };
  },
}));

vi.mock('googleapis', async () => {
  const actual = await vi.importActual<typeof import('googleapis')>('googleapis');
  const fakeGmail = {
    users: {
      drafts: { create: draftsCreate, send: draftsSend, delete: draftsDelete },
      settings: { sendAs: { list: sendAsList } },
    },
  };
  return { google: { auth: actual.google.auth, gmail: () => fakeGmail } };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUTH = bearer('test-user-1');

const SIGNATURE_HTML =
  '<div dir="ltr"><b>Aaron Rampersad</b><br>Archive | <a href="https://archive.com">archive.com</a></div>';
const SIGNATURE_PLAIN = 'Aaron Rampersad\nArchive | archive.com';

const mailbox = {
  id: 'mb-1',
  emailAddress: 'aaron@archive.com',
  displayName: 'Aaron Rampersad',
  provider: 'GMAIL',
  isActive: true,
  credentials: JSON.stringify({ access_token: 'x', refresh_token: 'y' }),
};
const candidate = { id: 'cand-1', name: 'Jane Doe', email: 'jane@example.com' };
const thread = {
  id: 'thread-1',
  externalThreadId: 'ext-thread-1',
  subject: 'Re: opportunity',
  mailboxId: mailbox.id,
  mailbox,
  candidate,
};

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function lastRawMime(): string {
  const call = draftsCreate.mock.calls.at(-1);
  expect(call).toBeDefined();
  return decodeRaw(call![0].requestBody.message.raw as string);
}

/**
 * Stateful single-row draft store so PATCH → approve sees what PATCH wrote,
 * exactly like the real DB would.
 */
function installDraftStore(initial: Record<string, unknown>) {
  let row: Record<string, unknown> = { ...initial };
  mockPrisma.emailDraft.findUnique.mockImplementation(async () => ({ ...row, thread }));
  mockPrisma.emailDraft.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    row = { ...row, ...data, updatedAt: new Date() };
    return { ...row };
  });
  mockPrisma.emailDraft.updateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (where.status && where.status !== row.status) return { count: 0 };
      row = { ...row, ...data, updatedAt: new Date() };
      return { count: 1 };
    }
  );
  return { get: () => row };
}

describe('draft edit → approve reaches Gmail (C1)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    draftsCreate.mockReset().mockResolvedValue({ data: { id: 'gmail-draft-1' } });
    draftsSend.mockReset().mockResolvedValue({ data: {} });
    draftsDelete.mockReset().mockResolvedValue({ data: {} });
    sendAsList.mockReset().mockResolvedValue({
      data: { sendAs: [{ isPrimary: true, signature: SIGNATURE_HTML }] },
    });
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox);
    app = await loadApp();
  });

  it('puts the edited text and the HTML signature in the raw MIME, not the original AI text', async () => {
    installDraftStore({
      id: 'draft-1',
      status: 'PENDING',
      subject: 'Re: opportunity',
      bodyText: `Hi Jane,\n\nOriginal AI wording.\n\nBest,\n${SIGNATURE_PLAIN}`,
      bodyHtml: `<div>Hi Jane,<br><br>Original AI wording.<br><br>Best,</div>${SIGNATURE_HTML}`,
      externalDraftId: null,
      inReplyToMessageId: null,
      referencesHeader: null,
      createdAt: new Date(),
    });

    const patch = await request(app)
      .patch('/api/drafts/draft-1')
      .set('Authorization', AUTH)
      .send({ bodyText: `Hi Jane,\n\nRecruiter-edited wording & <care>.\n\nBest,\n${SIGNATURE_PLAIN}` });
    expect(patch.status).toBe(200);

    const approve = await request(app)
      .post('/api/drafts/draft-1/approve')
      .set('Authorization', AUTH);
    expect(approve.status).toBe(200);

    const mime = lastRawMime();
    expect(mime).toContain('Recruiter-edited wording &amp; &lt;care&gt;.');
    expect(mime).not.toContain('Original AI wording');
    expect(mime).toContain(SIGNATURE_HTML);
    // Signature must appear once (HTML), not duplicated as plain text too.
    expect(mime.split('Aaron Rampersad').length - 1).toBe(1);
  });

  it('ignores client-supplied bodyHtml and strips CR/LF from an edited subject', async () => {
    const store = installDraftStore({
      id: 'draft-1',
      status: 'PENDING',
      subject: 'Re: opportunity',
      bodyText: `Hi\n${SIGNATURE_PLAIN}`,
      bodyHtml: `<div>Hi</div>${SIGNATURE_HTML}`,
      createdAt: new Date(),
    });
    await request(app)
      .patch('/api/drafts/draft-1')
      .set('Authorization', AUTH)
      .send({
        bodyText: `Edited\n${SIGNATURE_PLAIN}`,
        bodyHtml: '<img src=x onerror=alert(1)>',
        subject: 'Re: opportunity\r\nBcc: evil@x.com',
      })
      .expect(200);
    expect(store.get().bodyHtml).not.toContain('onerror');
    expect(store.get().bodyHtml).toContain('Edited');
    expect(store.get().bodyHtml).toContain(SIGNATURE_HTML);
    expect(store.get().subject).toBe('Re: opportunity Bcc: evil@x.com');
  });

  it('dictate rewrite keeps the HTML signature and sends only the core body to Claude', async () => {
    const store = installDraftStore({
      id: 'draft-1',
      status: 'PENDING',
      subject: 'Re: opportunity',
      bodyText: `Hi Jane,\n\nOriginal.\n\nBest,\n${SIGNATURE_PLAIN}`,
      bodyHtml: `<div>Original.</div>${SIGNATURE_HTML}`,
      externalDraftId: null,
      inReplyToMessageId: null,
      referencesHeader: null,
      createdAt: new Date(),
    });
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ subject: 'x', bodyText: 'Hi Jane,\n\nShorter.\n\nBest,' }) }],
    });

    await request(app)
      .post('/api/drafts/draft-1/dictate')
      .set('Authorization', AUTH)
      .send({ notes: 'make it shorter' })
      .expect(200);

    const prompt = anthropicCreate.mock.calls.at(-1)![0].messages[0].content as string;
    expect(prompt).not.toContain('Aaron Rampersad\nArchive');
    expect(store.get().bodyText).toBe(`Hi Jane,\n\nShorter.\n\nBest,\n${SIGNATURE_PLAIN}`);
    expect(store.get().bodyHtml).toContain(SIGNATURE_HTML);

    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);
    const mime = lastRawMime();
    expect(mime).toContain('Shorter.');
    expect(mime).toContain(SIGNATURE_HTML);
  });

  it('keeps the edited signature text when the recruiter changed the signature area', async () => {
    installDraftStore({
      id: 'draft-1',
      status: 'PENDING',
      subject: 'Re: opportunity',
      bodyText: `Hi Jane,\n\nOriginal.\n\nBest,\n${SIGNATURE_PLAIN}`,
      bodyHtml: `<div>Original.</div>${SIGNATURE_HTML}`,
      externalDraftId: null,
      inReplyToMessageId: null,
      referencesHeader: null,
      createdAt: new Date(),
    });

    await request(app)
      .patch('/api/drafts/draft-1')
      .set('Authorization', AUTH)
      .send({ bodyText: 'Hi Jane,\n\nEdited.\n\nCheers,\nAaron (mobile)' })
      .expect(200);
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);

    const mime = lastRawMime();
    expect(mime).toContain('Edited.');
    expect(mime).toContain('Aaron (mobile)');
    expect(mime).not.toContain('Original.');
  });
});

describe('createDraft MIME headers (M10 / M13)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    draftsCreate.mockReset().mockResolvedValue({ data: { id: 'gmail-draft-1' } });
    sendAsList.mockReset().mockResolvedValue({ data: { sendAs: [] } });
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox);
    app = await loadApp();
  });

  function headerBlock(mime: string): string[] {
    return mime.split('\r\n\r\n')[0]!.split('\r\n');
  }

  async function approveWith(overrides: Record<string, unknown>) {
    installDraftStore({
      id: 'draft-1',
      status: 'PENDING',
      subject: 'Re: opportunity',
      bodyText: 'Hi',
      bodyHtml: null,
      externalDraftId: null,
      inReplyToMessageId: null,
      referencesHeader: null,
      createdAt: new Date(),
      ...overrides,
    });
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);
    return lastRawMime();
  }

  it('strips CR/LF from the subject so it cannot inject headers', async () => {
    const mime = await approveWith({ subject: 'Re: hi\r\nBcc: evil@x.com' });
    const headers = headerBlock(mime);
    expect(headers.some((h) => /^Bcc:/i.test(h))).toBe(false);
    expect(headers).toContain('Subject: Re: hi Bcc: evil@x.com');
  });

  it('RFC 2047-encodes a non-ASCII subject', async () => {
    const mime = await approveWith({ subject: 'Re: Café opportunity — next steps' });
    const subjectLine = mime.split('\r\n').find((l) => l.startsWith('Subject: '))!;
    expect(subjectLine).toMatch(/^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    const words = [...mime.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)].map((m) =>
      Buffer.from(m[1]!, 'base64').toString('utf8')
    );
    expect(words.join('')).toBe('Re: Café opportunity — next steps');
  });

  it('emits In-Reply-To/References only for RFC Message-IDs, not Gmail API ids', async () => {
    const gmailIdMime = await approveWith({
      inReplyToMessageId: '18c2f0a9b1d2e3f4',
      referencesHeader: '18c2f0a9b1d2e3f4',
    });
    expect(gmailIdMime).not.toMatch(/^In-Reply-To:/m);
    expect(gmailIdMime).not.toMatch(/^References:/m);

    const rfcMime = await approveWith({
      inReplyToMessageId: '<CAB123@mail.gmail.com>',
      referencesHeader: '<root@mail.gmail.com> <CAB123@mail.gmail.com>\r\nBcc: x@y.z',
    });
    expect(rfcMime).toMatch(/^In-Reply-To: <CAB123@mail\.gmail\.com>\r$/m);
    expect(rfcMime).toMatch(/^References: <root@mail\.gmail\.com> <CAB123@mail\.gmail\.com>\r$/m);
    expect(rfcMime).not.toMatch(/^Bcc:/m);
  });
});
