// End-to-end (route → real gmail.service.createDraft → raw MIME) tests for the
// draft review loop. Unlike drafts.test.ts, createDraft is NOT mocked here:
// only the googleapis boundary and prisma are faked, so assertions run against
// the exact RFC 2822 message we would hand to Gmail.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { draftsCreate, draftsSend, draftsDelete, sendAsList } = vi.hoisted(() => ({
  draftsCreate: vi.fn(),
  draftsSend: vi.fn(),
  draftsDelete: vi.fn(),
  sendAsList: vi.fn(),
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
