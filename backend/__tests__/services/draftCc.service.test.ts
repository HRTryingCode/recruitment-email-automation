import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { listCcOptions, ccFirstName, resolveDraftCc, NO_CC } from '../../src/services/draftCc.service';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const ORIGINAL_ADMINS = process.env.ADMIN_EMAILS;

describe('listCcOptions', () => {
  beforeEach(() => {
    resetPrismaMock(mockPrisma);
    process.env.ADMIN_EMAILS = 'Sofia@archive.com, ethan@archive.com,andriy.korzhenevskyy@archive.com';
    mockPrisma.user.findMany.mockResolvedValue([
      { email: 'catalina.roman@archive.com', name: 'Catalina Roman' },
      { email: 'ethan@archive.com', name: null },
    ]);
    mockPrisma.mailbox.findMany.mockResolvedValue([
      { emailAddress: 'ethan@archive.com', displayName: 'Ethan Maenza' },
      { emailAddress: 'sofia@archive.com', displayName: 'Sofia Delgado' },
    ]);
  });
  afterEach(() => {
    process.env.ADMIN_EMAILS = ORIGINAL_ADMINS;
  });

  it('unions admin users and ADMIN_EMAILS, deduped case-insensitively', async () => {
    const opts = await listCcOptions();
    expect(opts.map((o) => o.email).sort()).toEqual([
      'andriy.korzhenevskyy@archive.com',
      'catalina.roman@archive.com',
      'ethan@archive.com',
      'sofia@archive.com',
    ]);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'admin' } })
    );
  });

  it('names come from User.name, then Mailbox.displayName, then the local-part', async () => {
    const byEmail = Object.fromEntries((await listCcOptions()).map((o) => [o.email, o]));
    expect(byEmail['catalina.roman@archive.com']).toMatchObject({ name: 'Catalina Roman', firstName: 'Catalina' });
    expect(byEmail['ethan@archive.com']).toMatchObject({ name: 'Ethan Maenza', firstName: 'Ethan' });
    expect(byEmail['andriy.korzhenevskyy@archive.com']).toMatchObject({
      name: 'andriy.korzhenevskyy',
      firstName: 'Andriy',
    });
  });

  it('includes the configured default CC even when it is not an admin', async () => {
    process.env.ADMIN_EMAILS = '';
    mockPrisma.user.findMany.mockResolvedValue([]);
    const opts = await listCcOptions();
    expect(opts.map((o) => o.email)).toEqual(['sofia@archive.com']);
  });

  it('excludes the draft mailbox owner', async () => {
    const opts = await listCcOptions({ excludeEmail: 'ETHAN@archive.com' });
    expect(opts.map((o) => o.email)).not.toContain('ethan@archive.com');
    expect(opts).toHaveLength(3);
  });
});

describe('ccFirstName', () => {
  beforeEach(() => resetPrismaMock(mockPrisma));

  it('prefers User.name, then Mailbox.displayName, then the local-part', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ name: 'Ethan Maenza' });
    expect(await ccFirstName('ethan@archive.com')).toBe('Ethan');

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce({ displayName: 'Sofia Delgado' });
    expect(await ccFirstName('sofia@archive.com')).toBe('Sofia');

    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.mailbox.findUnique.mockResolvedValueOnce(null);
    expect(await ccFirstName('catalina.roman@archive.com')).toBe('Catalina');
  });
});

describe('resolveDraftCc', () => {
  it('null (pre-F4 draft) falls back to the configured default', () => {
    expect(resolveDraftCc(null, 'aaron@archive.com')).toBe('sofia@archive.com');
    expect(resolveDraftCc(undefined, 'aaron@archive.com')).toBe('sofia@archive.com');
  });
  it('the NO_CC sentinel means no CC', () => {
    expect(resolveDraftCc(NO_CC, 'aaron@archive.com')).toBeNull();
  });
  it('a stored CC is used as-is', () => {
    expect(resolveDraftCc('ethan@archive.com', 'aaron@archive.com')).toBe('ethan@archive.com');
  });
  it('never CCs the mailbox owner, stored or default', () => {
    expect(resolveDraftCc('ethan@archive.com', 'Ethan@archive.com')).toBeNull();
    expect(resolveDraftCc(null, 'sofia@archive.com')).toBeNull();
  });
});
