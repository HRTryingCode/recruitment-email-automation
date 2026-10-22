import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

// Audit M11 / H2: sendAs aliases count as outbound, internal senders never
// become candidates, and each mailbox's sendAs list is persisted.

const { sendAsList, getAccessToken, classifyReply } = vi.hoisted(() => ({
  sendAsList: vi.fn(),
  getAccessToken: vi.fn(),
  classifyReply: vi.fn(),
}));

vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials() {}
    getAccessToken = getAccessToken;
  }
  return {
    google: {
      auth: { OAuth2 },
      gmail: () => ({ users: { settings: { sendAs: { list: sendAsList } } } }),
    },
  };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  // fetchAndStoreMessage also writes threads/messages; not in the shared mock.
  (prisma.emailThread as Record<string, unknown>).upsert = vi.fn();
  (prisma.emailMessage as Record<string, unknown>).create = vi.fn();
  return { prisma, default: prisma };
});

vi.mock('../../src/services/claude.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/claude.service')>(
    '../../src/services/claude.service'
  );
  return { ...actual, classifyReply };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  shouldSkipClassification,
  fetchAndStoreMessage,
  fetchMailboxSignature,
  refreshSendAsAddresses,
  serializeCredentials,
} from '../../src/services/gmail.service';

const mockPrisma = injectedPrisma as unknown as MockPrisma & {
  emailThread: MockPrisma['emailThread'] & { upsert: ReturnType<typeof vi.fn> };
  emailMessage: MockPrisma['emailMessage'] & { create: ReturnType<typeof vi.fn> };
};

function mailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mb-ethan',
    provider: 'GMAIL',
    emailAddress: 'emaenza@archive.com',
    displayName: 'Ethan Maenza',
    credentials: serializeCredentials({ refresh_token: 'r', access_token: 'a' }),
    watchExpiry: null,
    lastHistoryId: null,
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    sendAsAddresses: ['emaenza@archive.com', 'ethan@archive.com'],
    sendAsSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function gmailWithMessage(from: string) {
  return {
    users: {
      messages: {
        get: vi.fn().mockResolvedValue({
          data: {
            threadId: 't-1',
            internalDate: String(Date.parse('2026-10-01T12:00:00Z')),
            payload: {
              mimeType: 'text/plain',
              headers: [
                { name: 'From', value: from },
                { name: 'Subject', value: 'Re: Influencer Marketer role' },
              ],
              body: { data: Buffer.from('hello').toString('base64') },
            },
          },
        }),
      },
    },
  } as never;
}

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  mockPrisma.emailThread.upsert.mockReset();
  mockPrisma.emailMessage.create.mockReset();
  sendAsList.mockReset();
  getAccessToken.mockReset().mockResolvedValue({ token: 'a' });
  classifyReply.mockReset();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
});

describe('shouldSkipClassification', () => {
  const base = { subject: 'Re: role', mailboxEmail: 'emaenza@archive.com' };

  it('skips messages from a sendAs alias of the mailbox', () => {
    expect(
      shouldSkipClassification({
        ...base,
        fromAddress: 'Ethan@archive.com',
        mailboxAliases: ['ethan@archive.com'],
      })
    ).toBe(true);
  });

  it('skips any internal-domain sender (colleagues never become candidates)', () => {
    expect(shouldSkipClassification({ ...base, fromAddress: 'p.benigeri@archive.com' })).toBe(true);
  });

  it('does not skip an external candidate', () => {
    expect(shouldSkipClassification({ ...base, fromAddress: 'jane@gmail.com' })).toBe(false);
  });
});

describe('fetchAndStoreMessage', () => {
  it('treats a message from a sendAs alias as outbound (repliedAt, no classification)', async () => {
    mockPrisma.emailMessage.findUnique.mockResolvedValue(null);
    mockPrisma.emailThread.upsert.mockResolvedValue({ id: 'th-1', candidateId: 'cand-1', subject: 's' });
    mockPrisma.emailMessage.create.mockResolvedValue({});
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ id: 'prior-inbound' });
    mockPrisma.candidate.update.mockResolvedValue({});
    mockPrisma.emailDraft.updateMany.mockResolvedValue({ count: 0 });

    const stored = await fetchAndStoreMessage(
      gmailWithMessage('Ethan Maenza <Ethan@archive.com>'),
      mailbox() as never,
      'msg-1'
    );

    expect(stored).toBe('stored');
    expect(mockPrisma.candidate.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cand-1' } })
    );
    expect(classifyReply).not.toHaveBeenCalled();

    // priorInbound must exclude every own address and internal colleagues,
    // case-insensitively — not just the primary address.
    const where = mockPrisma.emailMessage.findFirst.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('ethan@archive.com');
    expect(JSON.stringify(where)).toContain('emaenza@archive.com');
    expect(JSON.stringify(where)).toContain('insensitive');
    expect(JSON.stringify(where)).toContain('@archive.com');
  });

  it('never classifies or creates a Candidate for an internal colleague', async () => {
    mockPrisma.emailMessage.findUnique.mockResolvedValue(null);
    mockPrisma.emailThread.upsert.mockResolvedValue({ id: 'th-2', candidateId: null, subject: 's' });
    mockPrisma.emailMessage.create.mockResolvedValue({});

    await fetchAndStoreMessage(
      gmailWithMessage('Sofia <sofia@archive.com>'),
      mailbox() as never,
      'msg-2'
    );

    expect(classifyReply).not.toHaveBeenCalled();
    expect(mockPrisma.candidate.findUnique).not.toHaveBeenCalled();
  });
});

describe('sendAs persistence', () => {
  it('fetchMailboxSignature persists the sendAs list it already fetched', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox({ sendAsAddresses: [] }));
    mockPrisma.mailbox.update.mockResolvedValue({});
    sendAsList.mockResolvedValue({
      data: {
        sendAs: [
          { sendAsEmail: 'emaenza@archive.com', isPrimary: true, signature: '<b>sig</b>' },
          { sendAsEmail: 'Ethan@archive.com' },
        ],
      },
    });

    const sig = await fetchMailboxSignature('mb-ethan');

    expect(sig).toBe('<b>sig</b>');
    expect(mockPrisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb-ethan' },
      data: {
        sendAsAddresses: ['emaenza@archive.com', 'ethan@archive.com'],
        sendAsSyncedAt: expect.any(Date),
      },
    });
  });

  it('refreshSendAsAddresses stores the normalized list and returns it', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox({ sendAsAddresses: [] }));
    mockPrisma.mailbox.update.mockResolvedValue({});
    sendAsList.mockResolvedValue({
      data: { sendAs: [{ sendAsEmail: 'PBenigeri@archive.com' }, { sendAsEmail: 'p.benigeri@archive.com' }] },
    });

    const out = await refreshSendAsAddresses('mb-ethan');

    expect(out).toEqual(['pbenigeri@archive.com', 'p.benigeri@archive.com']);
    expect(mockPrisma.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb-ethan' },
      data: { sendAsAddresses: out, sendAsSyncedAt: expect.any(Date) },
    });
  });

  it('refreshSendAsAddresses returns null and does not write when Gmail fails', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(mailbox());
    sendAsList.mockRejectedValue(new Error('boom'));

    await expect(refreshSendAsAddresses('mb-ethan')).resolves.toBeNull();
    expect(mockPrisma.mailbox.update).not.toHaveBeenCalled();
  });
});
