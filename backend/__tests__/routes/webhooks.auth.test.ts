// Audit B6 / M8: Pub/Sub push OIDC verification with real RS256 fixture
// tokens. The only thing stubbed is the Google cert download — signature,
// audience, issuer, expiry and claim checks all run through the real
// google-auth-library verifier.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

const { processWebhook } = vi.hoisted(() => ({ processWebhook: vi.fn() }));
vi.mock('../../src/services/gmail.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gmail.service')>(
    '../../src/services/gmail.service'
  );
  return { ...actual, processWebhook };
});
vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injectedPrisma } from '../../src/db/client';
import { _resetWebhookAuthSampler } from '../../src/routes/webhooks';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

const AUDIENCE = 'https://recruiting.example.com/api/webhooks/gmail';
const SA_EMAIL = 'pubsub-push@archive-project.iam.gserviceaccount.com';
const KID = 'test-kid-1';

const signingKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = signingKey.publicKey.export({ type: 'spki', format: 'pem' }).toString();

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function makeToken(
  claims: Record<string, unknown> = {},
  key: crypto.KeyObject = signingKey.privateKey
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    sub: '1234567890',
    email: SA_EMAIL,
    email_verified: true,
    iat: now - 10,
    exp: now + 3600,
    ...claims,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), key);
  return `${unsigned}.${b64url(sig)}`;
}

function body() {
  const data = Buffer.from(
    JSON.stringify({ emailAddress: 'inbox@archive.com', historyId: '1' })
  ).toString('base64');
  return { message: { data } };
}

function authRejectedRows() {
  return mockPrisma.systemLog.create.mock.calls.filter(
    ([arg]) => (arg as { data: { event: string } }).data.event === 'WEBHOOK_AUTH_REJECTED'
  );
}

describe('POST /api/webhooks/gmail — Pub/Sub OIDC (M8)', () => {
  const saved = {
    aud: process.env.PUBSUB_AUDIENCE,
    sa: process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL,
  };
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    processWebhook.mockReset();
    processWebhook.mockResolvedValue(undefined);
    _resetWebhookAuthSampler();
    vi.spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync').mockResolvedValue({
      certs: { [KID]: publicPem },
      format: 'PEM',
    } as never);
    process.env.PUBSUB_AUDIENCE = AUDIENCE;
    process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL = SA_EMAIL;
    app = await loadApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    for (const [k, v] of [
      ['PUBSUB_AUDIENCE', saved.aud],
      ['PUBSUB_SERVICE_ACCOUNT_EMAIL', saved.sa],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('accepts a valid token from the configured service account', async () => {
    const res = await request(app)
      .post('/api/webhooks/gmail')
      .set('Authorization', `Bearer ${makeToken()}`)
      .send(body());
    expect(res.status).toBe(200);
    expect(processWebhook).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['wrong audience', () => makeToken({ aud: 'https://evil.example.com' })],
    ['expired', () => makeToken({ iat: 1_000, exp: 2_000 })],
    ['signed by an unknown key', () => makeToken({}, otherKey.privateKey)],
    ['wrong issuer', () => makeToken({ iss: 'https://evil.example.com' })],
    ['a different service account', () => makeToken({ email: 'someone@other.iam.gserviceaccount.com' })],
    ['an unverified email claim', () => makeToken({ email_verified: false })],
    ['no email claim', () => makeToken({ email: undefined })],
  ])('rejects a token with %s', async (_label, mk) => {
    const res = await request(app)
      .post('/api/webhooks/gmail')
      .set('Authorization', `Bearer ${mk()}`)
      .send(body());
    expect(res.status).toBe(401);
    expect(processWebhook).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer header', async () => {
    const res = await request(app).post('/api/webhooks/gmail').send(body());
    expect(res.status).toBe(401);
    expect(processWebhook).not.toHaveBeenCalled();
  });

  it('samples rejection logging: a burst writes at most one SystemLog row per minute', async () => {
    for (let i = 0; i < 25; i++) {
      await request(app).post('/api/webhooks/gmail').send(body());
    }
    expect(authRejectedRows()).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61_000);
    await request(app).post('/api/webhooks/gmail').send(body());
    const rows = authRejectedRows();
    expect(rows).toHaveLength(2);
    const details = JSON.parse((rows[1][0] as { data: { details: string } }).data.details);
    expect(details.suppressedSinceLastLog).toBe(24);
  });

  it('stays backward compatible when PUBSUB_AUDIENCE is unset: accepts, warns, writes no SystemLog row', async () => {
    delete process.env.PUBSUB_AUDIENCE;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await request(app).post('/api/webhooks/gmail').send(body());
    expect(res.status).toBe(200);
    expect(processWebhook).toHaveBeenCalledTimes(1);
    expect(authRejectedRows()).toHaveLength(0);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('PUBSUB_AUDIENCE'))).toBe(true);
  });

  it('with an audience but no service-account email, verifies the JWT and still accepts', async () => {
    delete process.env.PUBSUB_SERVICE_ACCOUNT_EMAIL;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ok = await request(app)
      .post('/api/webhooks/gmail')
      .set('Authorization', `Bearer ${makeToken({ email: 'any@x.iam.gserviceaccount.com' })}`)
      .send(body());
    expect(ok.status).toBe(200);
    const bad = await request(app)
      .post('/api/webhooks/gmail')
      .set('Authorization', `Bearer ${makeToken({ aud: 'https://evil.example.com' })}`)
      .send(body());
    expect(bad.status).toBe(401);
  });
});
