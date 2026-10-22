// H2: once Lever webhooks are configured, 24h without a single delivery is
// worth a (non-paging) warning: the webhook was probably deleted/disabled in
// Lever or the signature tokens rotated. The 3h sync still covers us.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
import { collectHealthIssues, WATCHDOG_THRESHOLDS } from '../../src/services/monitoring.service';

const mockPrisma = injected as unknown as MockPrisma;
const NOW = new Date('2026-10-22T12:00:00Z');
const prev = process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;

beforeEach(() => {
  resetPrismaMock(mockPrisma);
  mockPrisma.mailbox.findMany.mockResolvedValue([]);
  // A recent reconcile so the dead-man's switch stays quiet.
  mockPrisma.systemLog.findMany.mockResolvedValue([
    { event: 'RECONCILIATION_RUN', details: '{"summary":true}', createdAt: new Date(NOW.getTime() - 60_000) },
  ]);
  mockPrisma.systemLog.findFirst.mockResolvedValue(null);
});
afterEach(() => {
  if (prev === undefined) delete process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;
  else process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS = prev;
});

describe('collectHealthIssues — lever_webhook_silent (H2)', () => {
  it('warns when tokens are set and no LEVER_WEBHOOK_RECEIVED in the last 24h', async () => {
    process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS = 'a,b';
    const issues = await collectHealthIssues(NOW);
    expect(issues).toEqual([
      expect.objectContaining({ key: 'lever_webhook_silent', type: 'lever_webhook_silent', severity: 'warning' }),
    ]);
    expect(mockPrisma.systemLog.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { event: 'LEVER_WEBHOOK_RECEIVED', createdAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } },
      })
    );
    expect(WATCHDOG_THRESHOLDS.leverWebhookSilentMs).toBe(24 * 3600_000);
  });

  it('is quiet when a webhook arrived within 24h', async () => {
    process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS = 'a';
    mockPrisma.systemLog.findFirst.mockResolvedValue({ id: 'log-1' });
    expect(await collectHealthIssues(NOW)).toEqual([]);
  });

  it('is quiet (and does not query) when webhooks are not configured', async () => {
    delete process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;
    expect(await collectHealthIssues(NOW)).toEqual([]);
    expect(mockPrisma.systemLog.findFirst).not.toHaveBeenCalled();
  });
});
