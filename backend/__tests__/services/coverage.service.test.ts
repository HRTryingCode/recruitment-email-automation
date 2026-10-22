import { describe, it, expect, beforeEach, vi } from 'vitest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

// Audit H2 / M32 phase 1: expected senders (admin list today, Gem later) are
// diffed against connected mailboxes + their sendAs aliases.

const { sendAlert } = vi.hoisted(() => ({ sendAlert: vi.fn() }));

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

vi.mock('../../src/services/alert.service', () => ({ sendAlert }));

import { prisma as injectedPrisma } from '../../src/db/client';
import {
  computeCoverage,
  formatCoverageAlert,
  sendWeeklyCoverageSummary,
  type ExpectedSenderSource,
} from '../../src/services/coverage.service';

const mockPrisma = injectedPrisma as unknown as MockPrisma;

const NOW = new Date('2026-10-22T12:00:00Z');

// Fixture modelled on prod: emaenza@ is connected with ethan@ NOT a sendAs
// alias; paul.benigeri@ is connected with p.benigeri@ as an alias but has no
// outbound; aaronrampersad@ is healthy.
function mailboxes() {
  return [
    {
      id: 'mb-emaenza',
      emailAddress: 'emaenza@archive.com',
      displayName: 'Ethan Maenza',
      sendAsAddresses: ['emaenza@archive.com'],
      sendAsSyncedAt: NOW,
      authStatus: 'OK',
    },
    {
      id: 'mb-paul',
      emailAddress: 'paul.benigeri@archive.com',
      displayName: 'Paul Benigeri',
      sendAsAddresses: ['paul.benigeri@archive.com', 'p.benigeri@archive.com'],
      sendAsSyncedAt: NOW,
      authStatus: 'OK',
    },
    {
      id: 'mb-aaron',
      emailAddress: 'aaronrampersad@archive.com',
      displayName: 'Aaron',
      sendAsAddresses: [],
      sendAsSyncedAt: null,
      authStatus: 'OK',
    },
  ];
}

function expected(rows: Array<Partial<{ emailAddress: string; expectedSends30d: number | null; displayName: string | null; source: string }>>) {
  return rows.map((r) => ({
    emailAddress: r.emailAddress!,
    displayName: r.displayName ?? null,
    source: r.source ?? 'ADMIN',
    expectedSends30d: r.expectedSends30d === undefined ? null : r.expectedSends30d,
  }));
}

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  sendAlert.mockReset().mockResolvedValue({ sent: true });
  mockPrisma.mailbox.findMany.mockResolvedValue(mailboxes());
  mockPrisma.emailMessage.groupBy.mockResolvedValue([
    { mailboxId: 'mb-aaron', fromAddress: 'AaronRampersad@archive.com', _count: { _all: 120 } },
    { mailboxId: 'mb-emaenza', fromAddress: 'sofia@archive.com', _count: { _all: 3 } },
  ]);
  mockPrisma.expectedSender.findMany.mockResolvedValue(
    expected([
      { emailAddress: 'ethan@archive.com', expectedSends30d: 478, displayName: 'Ethan (Gem alias)' },
      { emailAddress: 'p.benigeri@archive.com', expectedSends30d: 200 },
      { emailAddress: 'pbenigeri@archive.com' },
      { emailAddress: 'AaronRampersad@archive.com', expectedSends30d: 100 },
    ])
  );
});

describe('computeCoverage', () => {
  it('lists expected senders that no connected mailbox or alias covers', async () => {
    const report = await computeCoverage({ now: NOW });
    expect(report.unmonitored.map((u) => u.emailAddress).sort()).toEqual([
      'ethan@archive.com',
      'pbenigeri@archive.com',
    ]);
    const ethan = report.unmonitored.find((u) => u.emailAddress === 'ethan@archive.com')!;
    expect(ethan.expectedSends30d).toBe(478);
    expect(ethan.sources).toEqual(['ADMIN']);
  });

  it('treats a sendAs alias of a connected mailbox as monitored', async () => {
    const report = await computeCoverage({ now: NOW });
    expect(report.unmonitored.map((u) => u.emailAddress)).not.toContain('p.benigeri@archive.com');
  });

  it('flags connected mailboxes with 0 outbound in 30 days while sends are expected', async () => {
    const report = await computeCoverage({ now: NOW });
    expect(report.quietMailboxes).toEqual([
      {
        mailboxId: 'mb-paul',
        emailAddress: 'paul.benigeri@archive.com',
        outbound30d: 0,
        expectedAddresses: ['p.benigeri@archive.com'],
        expectedSends30d: 200,
      },
    ]);
  });

  it('counts outbound per mailbox only from its own addresses, case-insensitively', async () => {
    const report = await computeCoverage({ now: NOW });
    const byId = Object.fromEntries(report.mailboxes.map((m) => [m.id, m.outbound30d]));
    expect(byId).toEqual({ 'mb-emaenza': 0, 'mb-paul': 0, 'mb-aaron': 120 });
  });

  it('does not flag a quiet mailbox when upstream reports 0 expected sends', async () => {
    mockPrisma.expectedSender.findMany.mockResolvedValue(
      expected([{ emailAddress: 'p.benigeri@archive.com', expectedSends30d: 0 }])
    );
    const report = await computeCoverage({ now: NOW });
    expect(report.quietMailboxes).toEqual([]);
  });

  it('queries outbound in one grouped query over the last 30 days', async () => {
    await computeCoverage({ now: NOW });
    expect(mockPrisma.emailMessage.groupBy).toHaveBeenCalledTimes(1);
    const args = mockPrisma.emailMessage.groupBy.mock.calls[0][0];
    expect(args.where.receivedAt.gte).toEqual(new Date('2026-09-22T12:00:00Z'));
  });

  it('merges multiple sources (e.g. a future Gem sync) by normalized address', async () => {
    const gem: ExpectedSenderSource = {
      name: 'GEM',
      listExpectedSenders: async () =>
        expected([{ emailAddress: 'Ethan@archive.com', expectedSends30d: 500, source: 'GEM' }]),
    };
    const admin: ExpectedSenderSource = {
      name: 'ADMIN',
      listExpectedSenders: async () => expected([{ emailAddress: 'ethan@archive.com' }]),
    };
    const report = await computeCoverage({ now: NOW, sources: [admin, gem] });
    expect(report.unmonitored).toEqual([
      expect.objectContaining({
        emailAddress: 'ethan@archive.com',
        sources: ['ADMIN', 'GEM'],
        expectedSends30d: 500,
      }),
    ]);
  });
});

describe('formatCoverageAlert', () => {
  it('is a warning naming each unmonitored sender and quiet mailbox', async () => {
    const alert = formatCoverageAlert(await computeCoverage({ now: NOW }));
    expect(alert.severity).toBe('warning');
    expect(alert.text).toContain('ethan@archive.com');
    expect(alert.text).toContain('pbenigeri@archive.com');
    expect(alert.text).toContain('paul.benigeri@archive.com');
  });

  it('is resolved when everything is covered', async () => {
    mockPrisma.expectedSender.findMany.mockResolvedValue(
      expected([{ emailAddress: 'aaronrampersad@archive.com', expectedSends30d: 10 }])
    );
    const alert = formatCoverageAlert(await computeCoverage({ now: NOW }));
    expect(alert.severity).toBe('resolved');
  });
});

describe('sendWeeklyCoverageSummary', () => {
  it('sends the summary through alert.service and logs counts only', async () => {
    const result = await sendWeeklyCoverageSummary({ now: NOW });
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: true, unmonitored: 2, quietMailboxes: 1 });
    const logCall = mockPrisma.systemLog.create.mock.calls.find(
      (c) => c[0].data.event === 'SENDER_COVERAGE_SUMMARY'
    );
    expect(logCall).toBeDefined();
    expect(JSON.stringify(logCall![0].data)).not.toContain('@');
  });
});
