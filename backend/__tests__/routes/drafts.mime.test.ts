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
import { serializeCredentials } from '../../src/services/gmail.service';
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
  // Encrypted at rest, exactly as handleCallback stores it (no plaintext fallback).
  credentials: serializeCredentials({ access_token: 'x', refresh_token: 'y' }),
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
  // Minimal where-matcher: equality, `{ in: [...] }` and null — enough for the
  // conditional (compare-and-set) transitions the routes use.
  const matches = (where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'id') return v === row.id;
      if (v && typeof v === 'object' && 'in' in (v as object)) return (v as { in: unknown[] }).in.includes(row[k]);
      return (row[k] ?? null) === v;
    });
  mockPrisma.emailDraft.updateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      if (!matches(where)) return { count: 0 };
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

describe('draft state machine (M13)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    draftsCreate.mockReset().mockResolvedValue({ data: { id: 'gmail-draft-1' } });
    draftsSend.mockReset().mockResolvedValue({ data: {} });
    draftsDelete.mockReset().mockResolvedValue({ data: {} });
    sendAsList.mockReset().mockResolvedValue({ data: { sendAs: [] } });
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox);
    mockPrisma.candidate.update.mockResolvedValue({});
    app = await loadApp();
  });

  const base = {
    id: 'draft-1',
    subject: 'Re: opportunity',
    bodyText: 'Hi',
    bodyHtml: null,
    inReplyToMessageId: null,
    referencesHeader: null,
    createdAt: new Date(),
  };

  it('discard deletes the Gmail draft of an approved draft', async () => {
    const store = installDraftStore({ ...base, status: 'APPROVED', externalDraftId: 'gmail-draft-9' });
    await request(app).post('/api/drafts/draft-1/discard').set('Authorization', AUTH).expect(200);
    expect(store.get().status).toBe('DISCARDED');
    expect(draftsDelete).toHaveBeenCalledWith({ userId: 'me', id: 'gmail-draft-9' });
  });

  it('discard still succeeds when the Gmail draft is already gone', async () => {
    const store = installDraftStore({ ...base, status: 'APPROVED', externalDraftId: 'gmail-draft-9' });
    draftsDelete.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }));
    await request(app).post('/api/drafts/draft-1/discard').set('Authorization', AUTH).expect(200);
    expect(store.get().status).toBe('DISCARDED');
  });

  it('discard of a SENT draft returns 409', async () => {
    installDraftStore({ ...base, status: 'SENT', externalDraftId: 'gmail-draft-9' });
    await request(app).post('/api/drafts/draft-1/discard').set('Authorization', AUTH).expect(409);
    expect(draftsDelete).not.toHaveBeenCalled();
  });

  it('concurrent double-approve creates one Gmail draft and returns 409 to the loser', async () => {
    installDraftStore({ ...base, status: 'PENDING', externalDraftId: null });
    const [a, b] = await Promise.all([
      request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH),
      request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(draftsCreate).toHaveBeenCalledTimes(1);
  });

  it('approve rolls back to PENDING when Gmail draft creation fails', async () => {
    const store = installDraftStore({ ...base, status: 'PENDING', externalDraftId: null });
    draftsCreate.mockRejectedValueOnce(new Error('quota'));
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(502);
    expect(store.get().status).toBe('PENDING');
  });

  it('concurrent double-send sends once and returns 409 to the loser', async () => {
    installDraftStore({ ...base, status: 'APPROVED', externalDraftId: 'gmail-draft-1' });
    let sent = 0;
    draftsSend.mockImplementation(async () => {
      sent += 1;
      if (sent > 1) throw Object.assign(new Error('Requested entity was not found.'), { code: 404 });
      return { data: {} };
    });
    const [a, b] = await Promise.all([
      request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH),
      request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('concurrent sends of an approved draft without a Gmail draft create and send only one', async () => {
    installDraftStore({ ...base, status: 'APPROVED', externalDraftId: null });
    // Hold both Gmail creates until both requests are in flight, so they race
    // on persisting externalDraftId rather than one finishing first.
    let release!: () => void;
    const bothCalled = new Promise<void>((r) => (release = r));
    let n = 0;
    draftsCreate.mockImplementation(async () => {
      const mine = ++n;
      if (mine === 2) release();
      await bothCalled;
      return { data: { id: `gmail-${mine}` } };
    });
    const [a, b] = await Promise.all([
      request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH),
      request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(draftsSend).toHaveBeenCalledTimes(1);
    // The loser's duplicate Gmail draft is cleaned up.
    expect(draftsDelete).toHaveBeenCalledTimes(1);
  });
});
