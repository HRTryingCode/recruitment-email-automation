import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

// H1: a revoked refresh token (invalid_grant) must flip the mailbox to
// NEEDS_REAUTH, write exactly one MAILBOX_AUTH_REVOKED ERROR per incident,
// and never dump the GaxiosError (which carries the refresh token) to logs.

const { getAccessToken, watch, getProfile, getToken, userinfoGet } = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  watch: vi.fn(),
  getProfile: vi.fn(),
  getToken: vi.fn(),
  userinfoGet: vi.fn(),
}));

vi.mock('googleapis', () => {
  class OAuth2 {
    setCredentials() {}
    getAccessToken = getAccessToken;
    getToken = getToken;
    generateAuthUrl() {
      return 'https://example.test';
    }
  }
  return {
    google: {
      auth: { OAuth2 },
      gmail: () => ({ users: { watch, getProfile } }),
      oauth2: () => ({ userinfo: { get: userinfoGet } }),
    },
  };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

vi.mock('../../src/config', async () => {
  const actual = await vi.importActual<typeof import('../../src/config')>('../../src/config');
  return {
    ...actual,
    config: {
      ...actual.config,
      gmail: { ...actual.config.gmail, pubsubTopic: 'projects/p/topics/t' },
    },
  };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  renewGmailWatches,
  reconcileMailbox,
  handleCallback,
  serializeCredentials,
} from '../../src/services/gmail.service';
import { MailboxNeedsReauthError } from '../../src/lib/safeError';

const mockPrisma = injectedPrisma as unknown as MockPrisma;

function invalidGrant(): Error {
  const err = new Error('invalid_grant') as Error & Record<string, unknown>;
  err.name = 'GaxiosError';
  err.status = 400;
  err.config = { data: 'refresh_token=1//0SECRET-REFRESH&client_secret=GOCSPX-shh' };
  err.response = { status: 400, data: { error: 'invalid_grant' } };
  return err;
}

function mailbox(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mb-sofia',
    provider: 'GMAIL',
    emailAddress: 'sofia@archive.com',
    displayName: 'Sofia',
    credentials: serializeCredentials({ refresh_token: 'rt', access_token: 'at' }),
    watchExpiry: new Date('2026-05-29T00:00:00Z'),
    lastHistoryId: '1',
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-05-22T00:00:00Z'),
    ...overrides,
  };
}

function loggedEvents(): Array<{ event: string; level: string; details: string }> {
  return mockPrisma.systemLog.create.mock.calls.map((c) => c[0].data);
}

describe('gmail.service auth-revocation handling', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    getAccessToken.mockReset();
    watch.mockReset();
    getProfile.mockReset();
    getToken.mockReset();
    userinfoGet.mockReset();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // M7: nothing secret may reach the console on any path.
    const dumped = JSON.stringify(
      [...errorSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls],
      (_k, v) => (v instanceof Error ? { ...v, message: v.message } : v)
    );
    expect(dumped).not.toContain('SECRET');
    expect(dumped).not.toContain('GOCSPX');
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe('renewGmailWatches', () => {
    it('skips mailboxes already marked NEEDS_REAUTH', async () => {
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([]);
      await renewGmailWatches();
      expect(mockPrisma.mailbox.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ authStatus: { not: 'NEEDS_REAUTH' } }),
      });
    });

    it('marks the mailbox NEEDS_REAUTH and logs MAILBOX_AUTH_REVOKED + GMAIL_WATCH_RENEW_FAILED on invalid_grant', async () => {
      const mb = mailbox();
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mb);
      mockPrisma.mailbox.updateMany.mockResolvedValueOnce({ count: 1 });
      getAccessToken.mockRejectedValueOnce(invalidGrant());

      const renewed = await renewGmailWatches();

      expect(renewed).toBe(0);
      expect(watch).not.toHaveBeenCalled();
      expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledWith({
        where: { id: 'mb-sofia', authStatus: { not: 'NEEDS_REAUTH' } },
        data: expect.objectContaining({
          authStatus: 'NEEDS_REAUTH',
          lastAuthError: 'invalid_grant',
          lastAuthErrorAt: expect.any(Date),
        }),
      });
      const events = loggedEvents();
      const revoked = events.filter((e) => e.event === 'MAILBOX_AUTH_REVOKED');
      expect(revoked).toHaveLength(1);
      expect(revoked[0].level).toBe('ERROR');
      expect(revoked[0].details).toContain('sofia@archive.com');
      expect(revoked[0].details).not.toContain('SECRET');
      expect(events.some((e) => e.event === 'GMAIL_WATCH_RENEW_FAILED' && e.level === 'ERROR')).toBe(true);
    });

    it('writes MAILBOX_AUTH_REVOKED only once per incident', async () => {
      const mb = mailbox();
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mb);
      // Another path (e.g. reconcile) already flipped the row.
      mockPrisma.mailbox.updateMany.mockResolvedValueOnce({ count: 0 });
      getAccessToken.mockRejectedValueOnce(invalidGrant());

      await renewGmailWatches();

      expect(loggedEvents().filter((e) => e.event === 'MAILBOX_AUTH_REVOKED')).toHaveLength(0);
    });

    it('logs GMAIL_WATCH_RENEW_FAILED (not auth revoked) for transient errors', async () => {
      const mb = mailbox();
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mb);
      getAccessToken.mockResolvedValueOnce({ token: 'at' });
      watch.mockRejectedValueOnce(Object.assign(new Error('Backend Error'), { code: 503 }));

      const renewed = await renewGmailWatches();

      expect(renewed).toBe(0);
      expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled();
      const failed = loggedEvents().filter((e) => e.event === 'GMAIL_WATCH_RENEW_FAILED');
      expect(failed).toHaveLength(1);
      expect(failed[0].details).toContain('Backend Error');
      expect(failed[0].details).toContain('sofia@archive.com');
    });

    it('marks NEEDS_REAUTH when users.watch itself returns 401', async () => {
      const mb = mailbox();
      mockPrisma.mailbox.findMany.mockResolvedValueOnce([mb]);
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mb);
      mockPrisma.mailbox.updateMany.mockResolvedValueOnce({ count: 1 });
      getAccessToken.mockResolvedValueOnce({ token: 'at' });
      watch.mockRejectedValueOnce(Object.assign(new Error('Invalid Credentials'), { code: 401, status: 401 }));

      await renewGmailWatches();

      expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledTimes(1);
      expect(loggedEvents().filter((e) => e.event === 'MAILBOX_AUTH_REVOKED')).toHaveLength(1);
    });
  });

  describe('getGmailClient (via reconcileMailbox)', () => {
    it('throws MailboxNeedsReauthError without calling Google for a NEEDS_REAUTH mailbox', async () => {
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mailbox({ authStatus: 'NEEDS_REAUTH' }));

      await expect(reconcileMailbox('mb-sofia')).rejects.toBeInstanceOf(MailboxNeedsReauthError);
      expect(getAccessToken).not.toHaveBeenCalled();
    });

    it('marks NEEDS_REAUTH and throws MailboxNeedsReauthError when the token refresh fails with invalid_grant', async () => {
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mailbox());
      mockPrisma.mailbox.updateMany.mockResolvedValueOnce({ count: 1 });
      getAccessToken.mockRejectedValueOnce(invalidGrant());

      await expect(reconcileMailbox('mb-sofia')).rejects.toBeInstanceOf(MailboxNeedsReauthError);
      expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledTimes(1);
      expect(loggedEvents().filter((e) => e.event === 'MAILBOX_AUTH_REVOKED')).toHaveLength(1);
    });

    it('rethrows non-auth token errors unchanged', async () => {
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mailbox());
      getAccessToken.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(reconcileMailbox('mb-sofia')).rejects.toThrow('ETIMEDOUT');
      expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    it('resets authStatus to OK on reconnect and logs MAILBOX_AUTH_RESTORED', async () => {
      getToken.mockResolvedValueOnce({ tokens: { refresh_token: 'new', access_token: 'new' } });
      getProfile.mockResolvedValueOnce({ data: { emailAddress: 'sofia@archive.com', historyId: '99' } });
      userinfoGet.mockResolvedValueOnce({ data: { name: 'Sofia' } });
      mockPrisma.mailbox.findUnique.mockResolvedValueOnce(mailbox({ authStatus: 'NEEDS_REAUTH' }));
      mockPrisma.mailbox.upsert.mockResolvedValueOnce(mailbox());

      await handleCallback('code');

      const args = mockPrisma.mailbox.upsert.mock.calls[0][0];
      expect(args.update).toMatchObject({ authStatus: 'OK', lastAuthError: null, lastAuthErrorAt: null });
      expect(loggedEvents().some((e) => e.event === 'MAILBOX_AUTH_RESTORED')).toBe(true);
    });
  });
});
