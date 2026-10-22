// Audit B6 / L6: the Gmail OAuth callback only connects company mailboxes,
// and never re-activates an admin-disabled mailbox for a non-admin.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

const { getProfile, userinfoGet } = vi.hoisted(() => ({
  getProfile: vi.fn(),
  userinfoGet: vi.fn(),
}));

vi.mock('googleapis', () => {
  class FakeOAuth2 {
    getToken = vi.fn().mockResolvedValue({ tokens: { access_token: 'at', refresh_token: 'rt' } });
    setCredentials = vi.fn();
  }
  return {
    google: {
      auth: { OAuth2: FakeOAuth2 },
      gmail: () => ({ users: { getProfile } }),
      oauth2: () => ({ userinfo: { get: userinfoGet } }),
    },
  };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { handleCallback } from '../../src/services/gmail.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

function profile(emailAddress: string) {
  getProfile.mockResolvedValueOnce({ data: { emailAddress, historyId: '100' } });
}

describe('handleCallback (L6)', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    getProfile.mockReset();
    userinfoGet.mockReset();
    userinfoGet.mockResolvedValue({ data: { name: 'Recruiter Person' } });
    mockPrisma.mailbox.upsert.mockImplementation(async (args: { create: { emailAddress: string } }) => ({
      id: 'mb-new',
      emailAddress: args.create.emailAddress,
    }));
  });

  it('rejects a non-company Google account with 403 and writes nothing', async () => {
    profile('someone@gmail.com');
    await expect(handleCallback('code', { actorUserId: 'u1' })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.mailbox.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.mailbox.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a look-alike domain', async () => {
    profile('someone@archive.com.evil.io');
    await expect(handleCallback('code', { actorUserId: 'u1' })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.mailbox.upsert).not.toHaveBeenCalled();
  });

  it('connects a new company mailbox and attributes the connect', async () => {
    profile('newperson@archive.com');
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'recruiter' });

    await handleCallback('code', { actorUserId: 'u1' });

    expect(mockPrisma.mailbox.upsert).toHaveBeenCalledTimes(1);
    const logged = mockPrisma.systemLog.create.mock.calls.find(
      ([a]) => (a as { data: { event: string } }).data.event === 'MAILBOX_CONNECTED'
    );
    expect(JSON.parse((logged![0] as { data: { details: string } }).data.details)).toMatchObject({
      actorUserId: 'u1',
    });
  });

  it('lets a recruiter refresh credentials on an active mailbox (reconnect flow)', async () => {
    profile('aaron@archive.com');
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce({ id: 'mb-1', isActive: true, watchExpiry: null });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'recruiter' });
    await handleCallback('code', { actorUserId: 'u1' });
    expect(mockPrisma.mailbox.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses to re-activate an admin-disabled mailbox for a recruiter', async () => {
    profile('disabled@archive.com');
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce({ id: 'mb-2', isActive: false, watchExpiry: null });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'u1', role: 'recruiter' });
    await expect(handleCallback('code', { actorUserId: 'u1' })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.mailbox.upsert).not.toHaveBeenCalled();
  });

  it('refuses re-activation when the state carried no user (legacy state)', async () => {
    profile('disabled@archive.com');
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce({ id: 'mb-2', isActive: false, watchExpiry: null });
    await expect(handleCallback('code', { actorUserId: null })).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrisma.mailbox.upsert).not.toHaveBeenCalled();
  });

  it('lets an admin re-activate a disabled mailbox', async () => {
    profile('disabled@archive.com');
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce({ id: 'mb-2', isActive: false, watchExpiry: null });
    mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'admin1', role: 'admin' });
    await handleCallback('code', { actorUserId: 'admin1' });
    expect(mockPrisma.mailbox.upsert).toHaveBeenCalledTimes(1);
  });
});
