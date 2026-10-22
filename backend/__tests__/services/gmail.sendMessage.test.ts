// U0 one-step send goes straight through users.messages.send (no Gmail
// draft). The raw MIME must thread like the draft path: In-Reply-To,
// References, threadId, and the draft's CC.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

const { messagesSend } = vi.hoisted(() => ({ messagesSend: vi.fn() }));

vi.mock('googleapis', async () => {
  const actual = await vi.importActual<typeof import('googleapis')>('googleapis');
  const fakeGmail = { users: { messages: { send: messagesSend } } };
  return { google: { auth: actual.google.auth, gmail: () => fakeGmail } };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { sendMessage, serializeCredentials } from '../../src/services/gmail.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const mailbox = {
  id: 'mb-1',
  emailAddress: 'aaron@archive.com',
  provider: 'GMAIL',
  authStatus: 'OK',
  credentials: serializeCredentials({ access_token: 'x', refresh_token: 'y' }),
};

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

describe('gmail.service sendMessage (U0)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    messagesSend.mockReset().mockResolvedValue({ data: { id: 'gm-1', threadId: 'ext-thread-1' } });
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox);
  });

  it('sends raw MIME on the Gmail thread with threading headers and the chosen CC', async () => {
    const out = await sendMessage('mb-1', {
      threadId: 'thread-1',
      externalThreadId: 'ext-thread-1',
      subject: 'Re: opportunity',
      bodyText: 'Hi Jane',
      bodyHtml: '<div>Hi Jane</div>',
      inReplyToMessageId: '<abc@mail.example.com>',
      referencesHeader: '<root@mail.example.com> <abc@mail.example.com>',
      toAddress: 'jane@example.com',
      ccEmail: 'sofia@archive.com',
    });

    expect(out).toEqual({ id: 'gm-1', threadId: 'ext-thread-1' });
    const arg = messagesSend.mock.calls[0][0];
    expect(arg.userId).toBe('me');
    expect(arg.requestBody.threadId).toBe('ext-thread-1');
    const mime = decodeRaw(arg.requestBody.raw);
    expect(mime).toContain('To: jane@example.com\r\n');
    expect(mime).toContain('Cc: sofia@archive.com\r\n');
    expect(mime).toContain('In-Reply-To: <abc@mail.example.com>\r\n');
    expect(mime).toContain('References: <root@mail.example.com> <abc@mail.example.com>\r\n');
    expect(mime).toContain('<div>Hi Jane</div>');
  });

  it('omits Cc when the draft chose "No CC"', async () => {
    await sendMessage('mb-1', {
      threadId: 'thread-1',
      externalThreadId: 'ext-thread-1',
      subject: 'Re: x',
      bodyText: 'Hi',
      toAddress: 'jane@example.com',
      ccEmail: '',
    });
    const mime = decodeRaw(messagesSend.mock.calls[0][0].requestBody.raw);
    expect(mime).not.toMatch(/^Cc:/m);
  });
});
