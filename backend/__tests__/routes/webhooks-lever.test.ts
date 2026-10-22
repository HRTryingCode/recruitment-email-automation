// H2: POST /api/webhooks/lever — public, guarded by Lever's HMAC signature.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { createHmac } from 'crypto';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

const { processLeverWebhook, waitUntil } = vi.hoisted(() => ({
  processLeverWebhook: vi.fn(),
  waitUntil: vi.fn(),
}));
vi.mock('@vercel/functions', () => ({ waitUntil }));
vi.mock('../../src/services/leverRealtime.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/services/leverRealtime.service')>()),
  processLeverWebhook,
}));
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { _resetLeverWebhookSampler } from '../../src/routes/webhooks-lever';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const KEY = 'sig-token-2';
function payload(event: string, over: Record<string, unknown> = {}, key = KEY) {
  const token = 'delivery-token';
  const triggeredAt = Date.now() - 2000;
  return {
    triggeredAt,
    token,
    signature: createHmac('sha256', key).update(`${token}${triggeredAt}`).digest('hex'),
    event,
    data: { opportunityId: 'opp-1', contactId: 'contact-1', candidateId: 'opp-1' },
    ...over,
  };
}

describe('POST /api/webhooks/lever', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  const prevTokens = process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    _resetLeverWebhookSampler();
    processLeverWebhook.mockReset().mockResolvedValue({ duplicate: false, candidateIds: [] });
    waitUntil.mockReset();
    mockPrisma.systemLog.create.mockResolvedValue({});
    process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS = `sig-token-1, ${KEY}`;
    app = await loadApp();
  });
  afterEach(() => {
    if (prevTokens === undefined) delete process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;
    else process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS = prevTokens;
  });

  it('503s and does nothing when no signature tokens are configured', async () => {
    delete process.env.LEVER_WEBHOOK_SIGNATURE_TOKENS;
    const res = await request(app).post('/api/webhooks/lever').send(payload('candidateHired'));
    expect(res.status).toBe(503);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('401s on a bad signature and logs one sampled LEVER_WEBHOOK_REJECTED', async () => {
    const r1 = await request(app).post('/api/webhooks/lever').send(payload('candidateHired', {}, 'wrong'));
    const r2 = await request(app).post('/api/webhooks/lever').send(payload('candidateHired', {}, 'wrong'));
    expect([r1.status, r2.status]).toEqual([401, 401]);
    expect(waitUntil).not.toHaveBeenCalled();
    const events = mockPrisma.systemLog.create.mock.calls.map((c) => c[0].data.event);
    expect(events).toEqual(['LEVER_WEBHOOK_REJECTED']);
    expect(JSON.parse(mockPrisma.systemLog.create.mock.calls[0]![0].data.details).reason).toBe('bad_signature');
  });

  it('a non-JSON body gets 401, never 500', async () => {
    const res = await request(app).post('/api/webhooks/lever').send('not json').set('Content-Type', 'text/plain');
    expect(res.status).toBe(401);
  });

  it('malformed JSON is a 4xx, never 500', async () => {
    const res = await request(app).post('/api/webhooks/lever').set('Content-Type', 'application/json').send('{"token":');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('acks an unknown event type with 200 and ignores it', async () => {
    const res = await request(app).post('/api/webhooks/lever').send(payload('interviewCreated'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, ignored: true });
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('acks a known event with no opportunityId and ignores it', async () => {
    const res = await request(app).post('/api/webhooks/lever').send(payload('candidateHired', { data: {} }));
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  for (const event of [
    'applicationCreated',
    'candidateStageChange',
    'candidateArchiveChange',
    'candidateHired',
    'candidateDeleted',
  ]) {
    it(`${event}: 200 immediately, processing handed to waitUntil`, async () => {
      const body = payload(event);
      const res = await request(app).post('/api/webhooks/lever').send(body);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(waitUntil).toHaveBeenCalledTimes(1);
      await waitUntil.mock.calls[0]![0];
      expect(processLeverWebhook).toHaveBeenCalledWith({
        event,
        opportunityId: 'opp-1',
        triggeredAt: body.triggeredAt,
        dedupeKey: `${event}:opp-1:${body.triggeredAt}`,
      });
    });
  }

  it("uses Lever's delivery id as the dedupe key when present", async () => {
    await request(app).post('/api/webhooks/lever').send(payload('candidateHired', { id: 'evt-9' }));
    await waitUntil.mock.calls[0]![0];
    expect(processLeverWebhook.mock.calls[0]![0].dedupeKey).toBe('evt-9');
  });

  it('logs LEVER_WEBHOOK_ERROR when background processing fails (still 200)', async () => {
    processLeverWebhook.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/webhooks/lever').send(payload('candidateHired'));
    expect(res.status).toBe(200);
    await waitUntil.mock.calls[0]![0];
    const log = mockPrisma.systemLog.create.mock.calls.map((c) => c[0].data).find((d) => d.event === 'LEVER_WEBHOOK_ERROR');
    expect(log?.level).toBe('ERROR');
    expect(JSON.parse(log!.details)).toMatchObject({ event: 'candidateHired', opportunityId: 'opp-1', error: 'boom' });
  });
});
