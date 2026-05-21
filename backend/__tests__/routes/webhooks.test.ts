import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

// `webhooks.ts` calls `processWebhook` from gmail.service for any well-formed
// Pub/Sub push. Hoisted mock lets each test program the return / rejection.
const { processWebhook } = vi.hoisted(() => ({
  processWebhook: vi.fn(),
}));

vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return {
    ...actual,
    processWebhook,
  };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

// Pub/Sub `message.data` is base64-encoded JSON. The webhook decodes it to
// pull breadcrumbs (emailAddress, historyId) for error logs.
function makePubSubBody(payload: Record<string, unknown>) {
  const data = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
  return { message: { data } };
}

// processWebhook is dispatched via `void processWebhook(...).catch(...)`, so
// the route returns 200 before the catch runs. Flush pending microtasks +
// macrotasks so the .catch (and its logEvent → systemLog.create) has fired by
// the time the test asserts.
async function flushAsync() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

describe('POST /api/webhooks/gmail', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    processWebhook.mockReset();
    app = await loadApp();
  });

  it('returns 200 without throwing when the body is empty', async () => {
    const res = await request(app).post('/api/webhooks/gmail').send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // No `message.data` → handler short-circuits before dispatching.
    expect(processWebhook).not.toHaveBeenCalled();
    // The empty-body branch is a normal no-op; it should NOT log WEBHOOK_HANDLER_ERROR.
    const errorEventLogged = mockPrisma.systemLog.create.mock.calls.some(
      (call) =>
        (call[0] as { data: { event: string } }).data.event === 'WEBHOOK_HANDLER_ERROR'
    );
    expect(errorEventLogged).toBe(false);
  });

  it('returns 200 AND logs WEBHOOK_HANDLER_ERROR when the inner processor rejects', async () => {
    // Body looks like a Pub/Sub push (so we get past the `message.data`
    // guard), but processWebhook rejects — simulating the "malformed payload
    // reaches processWebhook" path. The route MUST still return 200 so
    // Pub/Sub doesn't retry the bad notification.
    processWebhook.mockRejectedValueOnce(new Error('Malformed envelope: cannot parse history'));

    const body = makePubSubBody({
      emailAddress: 'inbox@archive.com',
      historyId: '12345',
    });

    const res = await request(app).post('/api/webhooks/gmail').send(body);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await flushAsync();

    expect(processWebhook).toHaveBeenCalledTimes(1);
    const errorCalls = mockPrisma.systemLog.create.mock.calls.filter(
      (call) =>
        (call[0] as { data: { event: string } }).data.event === 'WEBHOOK_HANDLER_ERROR'
    );
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);

    // Breadcrumbs from the Pub/Sub payload should make it into the log details.
    const detailsRaw = (errorCalls[0]?.[0] as { data: { details: string } }).data.details;
    expect(detailsRaw).toContain('Malformed envelope');
    expect(detailsRaw).toContain('inbox@archive.com');
  });

  it('calls processWebhook with the Pub/Sub body for a well-formed payload', async () => {
    processWebhook.mockResolvedValueOnce(undefined);

    const body = makePubSubBody({
      emailAddress: 'inbox@archive.com',
      historyId: '99999',
    });

    const res = await request(app).post('/api/webhooks/gmail').send(body);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    await flushAsync();

    expect(processWebhook).toHaveBeenCalledTimes(1);
    // The route forwards the full body — processWebhook is responsible for
    // decoding the base64 data and looking up the mailbox by emailAddress.
    const callArg = processWebhook.mock.calls[0]?.[0] as { message: { data: string } };
    expect(callArg.message.data).toBe(body.message.data);
    const decoded = JSON.parse(
      Buffer.from(callArg.message.data, 'base64').toString('utf-8')
    ) as { emailAddress: string; historyId: string };
    expect(decoded.emailAddress).toBe('inbox@archive.com');
    expect(decoded.historyId).toBe('99999');

    // Happy path should NOT log WEBHOOK_HANDLER_ERROR.
    const errorCalls = mockPrisma.systemLog.create.mock.calls.filter(
      (call) =>
        (call[0] as { data: { event: string } }).data.event === 'WEBHOOK_HANDLER_ERROR'
    );
    expect(errorCalls.length).toBe(0);
  });
});

// Pub/Sub JWT validation is opt-in via PUBSUB_AUDIENCE. We reload the app
// module with the env var set so webhooks.ts wires its OAuth2Client; then
// verify that POSTs missing Authorization get rejected with 401 before
// reaching the inner processor.
describe('POST /api/webhooks/gmail (with PUBSUB_AUDIENCE enabled)', () => {
  const originalAudience = process.env.PUBSUB_AUDIENCE;

  beforeEach(() => {
    process.env.PUBSUB_AUDIENCE = 'https://recruitment-email.archive.com/api/webhooks/gmail';
    // Force webhooks.ts (and app.ts, which transitively imports it) to be
    // re-evaluated so the env var is read fresh.
    vi.resetModules();
    resetPrismaMock(mockPrisma);
    processWebhook.mockReset();
  });

  afterEach(() => {
    if (originalAudience === undefined) {
      delete process.env.PUBSUB_AUDIENCE;
    } else {
      process.env.PUBSUB_AUDIENCE = originalAudience;
    }
    vi.resetModules();
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const freshApp = await loadApp();

    const res = await request(freshApp)
      .post('/api/webhooks/gmail')
      .send(makePubSubBody({ emailAddress: 'inbox@archive.com', historyId: '1' }));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer token/i);
    // The inner processor must never run when the auth check fails.
    expect(processWebhook).not.toHaveBeenCalled();
  });
});
