// Per-draft CC (F4): GET /api/drafts/cc-options, PATCH { ccEmail }, and the
// raw MIME the approve/send paths hand to Gmail. Like drafts.mime.test.ts the
// real gmail.service runs; only googleapis and prisma are faked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const { draftsCreate, draftsUpdate, draftsSend, draftsDelete, sendAsList } = vi.hoisted(() => ({
  draftsCreate: vi.fn(),
  draftsUpdate: vi.fn(),
  draftsSend: vi.fn(),
  draftsDelete: vi.fn(),
  sendAsList: vi.fn(),
}));

vi.mock('googleapis', async () => {
  const actual = await vi.importActual<typeof import('googleapis')>('googleapis');
  const fakeGmail = {
    users: {
      drafts: { create: draftsCreate, update: draftsUpdate, send: draftsSend, delete: draftsDelete },
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
import { loopInSentence } from '../../src/lib/handoffLoopIn';
import type { HandoffType } from '../../src/services/claude.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUTH = bearer('test-user-1');
const SIGNATURE_HTML = '<div dir="ltr"><b>Aaron Rampersad</b><br>Archive</div>';
const SIGNATURE_PLAIN = 'Aaron Rampersad\nArchive';

const mailbox = {
  id: 'mb-1',
  emailAddress: 'aaron@archive.com',
  displayName: 'Aaron Rampersad',
  provider: 'GMAIL',
  isActive: true,
  handoffProfile: null,
  credentials: serializeCredentials({ access_token: 'x', refresh_token: 'y' }),
};
const candidate = { id: 'cand-1', name: 'Jane Doe', email: 'jane@example.com', role: null };
const thread = {
  id: 'thread-1',
  externalThreadId: 'ext-thread-1',
  subject: 'Re: opportunity',
  mailboxId: mailbox.id,
  mailbox,
  candidate,
};

const USERS: Record<string, { name: string | null }> = {
  'catalina.roman@archive.com': { name: 'Catalina Roman' },
  'sofia@archive.com': { name: 'Sofia Delgado' },
};

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function headersOf(raw: string): string[] {
  return decodeRaw(raw).split('\r\n\r\n')[0]!.split('\r\n');
}

function installDraftStore(initial: Record<string, unknown>) {
  let row: Record<string, unknown> = {
    id: 'draft-1',
    subject: 'Re: opportunity',
    classification: 'INTERESTED',
    externalDraftId: null,
    inReplyToMessageId: null,
    referencesHeader: null,
    createdAt: new Date(),
    ...initial,
  };
  mockPrisma.emailDraft.findUnique.mockImplementation(async () => ({ ...row, thread }));
  mockPrisma.emailDraft.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    row = { ...row, ...data, updatedAt: new Date() };
    return { ...row };
  });
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

function handoffBody(type: HandoffType, name: string): string {
  return `Hi Jane,\n\nThanks for getting back to me.\n\n${loopInSentence(type, name)}\n\nBest,\n${SIGNATURE_PLAIN}`;
}

const ORIGINAL_OPTIONS = process.env.DRAFT_CC_OPTIONS;
const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS;
const RECRUITMENT_TEAM = 'sofia@archive.com,andriy.korzhenevskyy@archive.com,catalina.roman@archive.com';
let app: Awaited<ReturnType<typeof loadApp>>;

beforeEach(async () => {
  resetPrismaMock(mockPrisma);
  process.env.DRAFT_CC_OPTIONS = RECRUITMENT_TEAM;
  // Ethan is an admin but not on the recruitment team: never a CC option.
  process.env.ADMIN_EMAILS = `${RECRUITMENT_TEAM},ethan@archive.com`;
  draftsCreate.mockReset().mockResolvedValue({ data: { id: 'gmail-draft-1' } });
  draftsUpdate.mockReset().mockResolvedValue({ data: { id: 'gmail-draft-1' } });
  draftsSend.mockReset().mockResolvedValue({ data: {} });
  draftsDelete.mockReset().mockResolvedValue({ data: {} });
  sendAsList.mockReset().mockResolvedValue({
    data: { sendAs: [{ isPrimary: true, signature: SIGNATURE_HTML }] },
  });
  mockPrisma.mailbox.findUnique.mockImplementation(async ({ where }: { where: { id?: string; emailAddress?: string } }) =>
    where.id === mailbox.id || where.emailAddress === mailbox.emailAddress ? mailbox : null
  );
  mockPrisma.mailbox.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([]);
  mockPrisma.user.findUnique.mockImplementation(async ({ where }: { where: { email?: string } }) =>
    where.email && USERS[where.email] ? USERS[where.email] : null
  );
  app = await loadApp();
});

afterEach(() => {
  process.env.DRAFT_CC_OPTIONS = ORIGINAL_OPTIONS;
  process.env.ADMIN_EMAILS = ORIGINAL_ADMINS;
});

describe('approve/send MIME uses the draft\'s stored CC', () => {
  it('stored ccEmail replaces the default Cc header', async () => {
    installDraftStore({ status: 'PENDING', bodyText: 'Hi', bodyHtml: '<div>Hi</div>', ccEmail: 'catalina.roman@archive.com' });
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);
    const headers = headersOf(draftsCreate.mock.calls.at(-1)![0].requestBody.message.raw);
    expect(headers).toContain('Cc: catalina.roman@archive.com');
    expect(headers.join('\n')).not.toContain('sofia@archive.com');
  });

  it('"No CC" (empty string) sends without a Cc header', async () => {
    installDraftStore({ status: 'APPROVED', bodyText: 'Hi', bodyHtml: '<div>Hi</div>', ccEmail: '' });
    await request(app).post('/api/drafts/draft-1/send').set('Authorization', AUTH).expect(200);
    const headers = headersOf(draftsCreate.mock.calls.at(-1)![0].requestBody.message.raw);
    expect(headers.some((h) => h.startsWith('Cc:'))).toBe(false);
  });

  it('a pre-F4 draft (ccEmail null) still CCs the configured default', async () => {
    installDraftStore({ status: 'PENDING', bodyText: 'Hi', bodyHtml: '<div>Hi</div>', ccEmail: null });
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);
    const headers = headersOf(draftsCreate.mock.calls.at(-1)![0].requestBody.message.raw);
    expect(headers).toContain('Cc: sofia@archive.com');
  });

  it('never CCs the mailbox owner even if stored', async () => {
    installDraftStore({ status: 'PENDING', bodyText: 'Hi', bodyHtml: '<div>Hi</div>', ccEmail: 'aaron@archive.com' });
    await request(app).post('/api/drafts/draft-1/approve').set('Authorization', AUTH).expect(200);
    const headers = headersOf(draftsCreate.mock.calls.at(-1)![0].requestBody.message.raw);
    expect(headers.some((h) => h.startsWith('Cc:'))).toBe(false);
  });

  it('GET /api/drafts/:id serves the stored CC as ccAddress', async () => {
    installDraftStore({ status: 'PENDING', bodyText: 'Hi', ccEmail: 'catalina.roman@archive.com' });
    mockPrisma.emailDraft.findUnique.mockResolvedValueOnce({
      id: 'draft-1',
      status: 'PENDING',
      ccEmail: 'catalina.roman@archive.com',
      inReplyToMessageId: null,
      thread: { ...thread, messages: [] },
    });
    const res = await request(app).get('/api/drafts/draft-1').set('Authorization', AUTH).expect(200);
    expect(res.body.data.ccAddress).toBe('catalina.roman@archive.com');
  });
});

describe('GET /api/drafts/cc-options', () => {
  it('returns No CC plus the recruitment team (DRAFT_CC_OPTIONS), with names', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ email: 'catalina.roman@archive.com', name: 'Catalina Roman' }]);
    mockPrisma.mailbox.findMany.mockResolvedValue([{ emailAddress: 'sofia@archive.com', displayName: 'Sofia Delgado' }]);
    const res = await request(app).get('/api/drafts/cc-options').set('Authorization', AUTH).expect(200);
    expect(res.body.data[0]).toEqual({ email: null, name: 'No CC', firstName: null });
    const emails = res.body.data.slice(1).map((o: { email: string }) => o.email).sort();
    expect(emails).toEqual(['andriy.korzhenevskyy@archive.com', 'catalina.roman@archive.com', 'sofia@archive.com']);
    expect(res.body.data.find((o: { email: string }) => o.email === 'sofia@archive.com').name).toBe('Sofia Delgado');
  });

  it('does not offer an admin who is not on the recruitment team', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ email: 'ethan@archive.com', name: 'Ethan Maenza', role: 'admin' }]);
    const res = await request(app).get('/api/drafts/cc-options').set('Authorization', AUTH).expect(200);
    expect(res.body.data.map((o: { email: string | null }) => o.email)).not.toContain('ethan@archive.com');
  });

  it('?draftId= leaves out the draft mailbox owner', async () => {
    process.env.DRAFT_CC_OPTIONS = 'sofia@archive.com,aaron@archive.com';
    installDraftStore({ status: 'PENDING', bodyText: 'Hi' });
    const res = await request(app)
      .get('/api/drafts/cc-options?draftId=draft-1')
      .set('Authorization', AUTH)
      .expect(200);
    expect(res.body.data.map((o: { email: string | null }) => o.email)).toEqual([null, 'sofia@archive.com']);
  });

  it('requires auth', async () => {
    await request(app).get('/api/drafts/cc-options').expect(401);
  });
});

describe('PATCH /api/drafts/:id { ccEmail }', () => {
  it('stores a valid admin CC and reports it', async () => {
    const store = installDraftStore({ status: 'PENDING', bodyText: 'Hi Jane', classification: 'NEUTRAL', ccEmail: 'sofia@archive.com' });
    const res = await request(app)
      .patch('/api/drafts/draft-1')
      .set('Authorization', AUTH)
      .send({ ccEmail: 'Catalina.Roman@archive.com' })
      .expect(200);
    expect(store.get().ccEmail).toBe('catalina.roman@archive.com');
    expect(res.body.data.ccAddress).toBe('catalina.roman@archive.com');
    expect(res.body.ccChange).toMatchObject({ ccAddress: 'catalina.roman@archive.com', firstName: 'Catalina', loopIn: 'not_handoff' });
    expect(store.get().bodyText).toBe('Hi Jane');
  });

  it('null stores "No CC"', async () => {
    const store = installDraftStore({ status: 'PENDING', bodyText: 'Hi Jane', classification: 'NEUTRAL', ccEmail: 'sofia@archive.com' });
    const res = await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: null }).expect(200);
    expect(store.get().ccEmail).toBe('');
    expect(res.body.data.ccAddress).toBeNull();
  });

  it('400s on an address that is not a CC option', async () => {
    const store = installDraftStore({ status: 'PENDING', bodyText: 'Hi', ccEmail: 'sofia@archive.com' });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'evil@example.com' }).expect(400);
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'not-an-email' }).expect(400);
    expect(store.get().ccEmail).toBe('sofia@archive.com');
  });

  it('400s on an admin who is not on the recruitment team (ethan@archive.com)', async () => {
    const store = installDraftStore({ status: 'PENDING', bodyText: 'Hi', ccEmail: 'sofia@archive.com' });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'ethan@archive.com' }).expect(400);
    expect(store.get().ccEmail).toBe('sofia@archive.com');
  });

  it('400s when the CC would be the mailbox owner', async () => {
    process.env.DRAFT_CC_OPTIONS = 'sofia@archive.com,aaron@archive.com';
    installDraftStore({ status: 'PENDING', bodyText: 'Hi' });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'aaron@archive.com' }).expect(400);
  });

  it.each(['SENT', 'DISCARDED'])('400s on a %s draft', async (status) => {
    const store = installDraftStore({ status, bodyText: 'Hi', ccEmail: 'sofia@archive.com' });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'catalina.roman@archive.com' }).expect(400);
    expect(store.get().ccEmail).toBe('sofia@archive.com');
  });

  it('400s on body edits to an APPROVED draft, even alongside ccEmail', async () => {
    installDraftStore({ status: 'APPROVED', bodyText: 'Hi', ccEmail: 'sofia@archive.com' });
    await request(app)
      .patch('/api/drafts/draft-1')
      .set('Authorization', AUTH)
      .send({ ccEmail: 'catalina.roman@archive.com', bodyText: 'changed' })
      .expect(400);
  });

  it('APPROVED draft with a Gmail draft: updates the Gmail draft so its Cc matches', async () => {
    const store = installDraftStore({
      status: 'APPROVED',
      bodyText: handoffBody('coordinator', 'Sofia'),
      ccEmail: 'sofia@archive.com',
      externalDraftId: 'gmail-draft-1',
    });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'catalina.roman@archive.com' }).expect(200);
    expect(draftsUpdate).toHaveBeenCalledTimes(1);
    const call = draftsUpdate.mock.calls[0]![0];
    expect(call.id).toBe('gmail-draft-1');
    const mime = decodeRaw(call.requestBody.message.raw);
    expect(headersOf(call.requestBody.message.raw)).toContain('Cc: catalina.roman@archive.com');
    expect(mime).toContain("looping in Catalina from the recruitment team here");
    expect(call.requestBody.message.threadId).toBe('ext-thread-1');
    expect(store.get().ccEmail).toBe('catalina.roman@archive.com');
  });

  it('APPROVED draft whose Gmail draft is gone: clears externalDraftId so send re-creates it', async () => {
    draftsUpdate.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code: 404 }));
    const store = installDraftStore({
      status: 'APPROVED',
      bodyText: 'Hi',
      classification: 'NEUTRAL',
      ccEmail: 'sofia@archive.com',
      externalDraftId: 'gmail-draft-1',
    });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'catalina.roman@archive.com' }).expect(200);
    expect(store.get().externalDraftId).toBeNull();
    expect(store.get().ccEmail).toBe('catalina.roman@archive.com');
  });

  it('APPROVED draft: a Gmail failure leaves the DB untouched (502)', async () => {
    draftsUpdate.mockRejectedValueOnce(new Error('backend error'));
    const store = installDraftStore({
      status: 'APPROVED',
      bodyText: 'Hi',
      ccEmail: 'sofia@archive.com',
      externalDraftId: 'gmail-draft-1',
    });
    await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'catalina.roman@archive.com' }).expect(502);
    expect(store.get().ccEmail).toBe('sofia@archive.com');
  });

  describe('hand-off loop-in re-render', () => {
    it.each(['coordinator', 'sofia_interviews', 'ethan_interviews_sofia_schedules'] as HandoffType[])(
      '%s: renames the person looped in and re-renders the HTML',
      async (type) => {
        const store = installDraftStore({
          status: 'PENDING',
          bodyText: handoffBody(type, 'Sofia'),
          bodyHtml: '<div>old</div>',
          ccEmail: 'sofia@archive.com',
        });
        const res = await request(app)
          .patch('/api/drafts/draft-1')
          .set('Authorization', AUTH)
          .send({ ccEmail: 'catalina.roman@archive.com' })
          .expect(200);
        expect(store.get().bodyText).toBe(handoffBody(type, 'Catalina'));
        expect(store.get().bodyHtml).toContain('looping in Catalina');
        expect(store.get().bodyHtml).toContain(SIGNATURE_HTML);
        expect(res.body.ccChange.loopIn).toBe('updated');
        expect(res.body.data.bodyText).toBe(handoffBody(type, 'Catalina'));
      }
    );

    it('a recruiter-edited loop-in is left alone and flagged for a manual fix', async () => {
      const edited = `Hi Jane,\n\nSofia will reach out to you shortly.\n\nBest,\n${SIGNATURE_PLAIN}`;
      const store = installDraftStore({ status: 'PENDING', bodyText: edited, ccEmail: 'sofia@archive.com' });
      const res = await request(app)
        .patch('/api/drafts/draft-1')
        .set('Authorization', AUTH)
        .send({ ccEmail: 'catalina.roman@archive.com' })
        .expect(200);
      expect(store.get().bodyText).toBe(edited);
      expect(store.get().ccEmail).toBe('catalina.roman@archive.com');
      expect(res.body.ccChange.loopIn).toBe('not_found');
    });

    it('No CC on a hand-off draft keeps the body and warns', async () => {
      const body = handoffBody('coordinator', 'Sofia');
      const store = installDraftStore({ status: 'PENDING', bodyText: body, ccEmail: 'sofia@archive.com' });
      const res = await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: null }).expect(200);
      expect(store.get().bodyText).toBe(body);
      expect(res.body.ccChange.handoffWithoutCc).toBe(true);
    });

    it('rewrites a legacy draft (ccEmail null, old "she\'ll" template)', async () => {
      const legacy = `Hi Jane,\n\nI hope you're doing well.\n\nI'm looping in Sofia from the recruitment team here to schedule time with you and share more about the position.\n\nBest,\n${SIGNATURE_PLAIN}`;
      const store = installDraftStore({ status: 'PENDING', bodyText: legacy, ccEmail: null });
      await request(app).patch('/api/drafts/draft-1').set('Authorization', AUTH).send({ ccEmail: 'catalina.roman@archive.com' }).expect(200);
      expect(store.get().bodyText).toContain(loopInSentence('coordinator', 'Catalina'));
      expect(store.get().bodyText).not.toMatch(/\bshe\b|she'll/);
    });
  });
});
