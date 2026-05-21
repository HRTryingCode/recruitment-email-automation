import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';

// `auth.ts` constructs `new OAuth2Client(config.gmail.clientId)` at module
// load and calls `verifyIdToken` on every /google request. Tests program the
// returned ticket per case via this hoisted mock.
const { verifyIdToken } = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class FakeOAuth2Client {
    verifyIdToken = verifyIdToken;
  },
}));

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

// Pull the same mock instance the route sees so tests can program it.
import { prisma as injectedPrisma } from '../../src/db/client';
const mockPrisma = injectedPrisma as unknown as MockPrisma;

function ticketFor(payload: Record<string, unknown>) {
  return { getPayload: () => payload };
}

describe('POST /api/auth/google', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    verifyIdToken.mockReset();
    app = await loadApp();
  });

  it('issues a JWT for a verified @archive.com Google token', async () => {
    verifyIdToken.mockResolvedValueOnce(
      ticketFor({
        email: 'someone@archive.com',
        email_verified: true,
        sub: 'google-sub-123',
        name: 'Someone',
        picture: 'https://example.com/avatar.png',
      })
    );
    // No existing user → /google creates one.
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user.create.mockResolvedValueOnce({
      id: 'user-1',
      email: 'someone@archive.com',
      name: 'Someone',
      avatarUrl: 'https://example.com/avatar.png',
      googleId: 'google-sub-123',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.token).toBe('string');
    expect(res.body.data.token.length).toBeGreaterThan(20);
    expect(res.body.data.user).toMatchObject({
      id: 'user-1',
      email: 'someone@archive.com',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: 'fake-id-token',
      audience: expect.any(String),
    });
  });

  it('rejects a verified Google token whose email is not @archive.com with 403', async () => {
    verifyIdToken.mockResolvedValueOnce(
      ticketFor({
        email: 'someone@gmail.com',
        email_verified: true,
        sub: 'google-sub-456',
      })
    );

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/archive\.com/i);
    // Should not have touched the DB.
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('returns 401 when verifyIdToken throws (malformed/invalid token)', async () => {
    verifyIdToken.mockRejectedValueOnce(new Error('Wrong number of segments'));

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'not-a-real-jwt' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/invalid google id token/i);
  });

  it('returns 401 when the verified payload is missing required claims', async () => {
    // email_verified=false simulates an unverified Google account.
    verifyIdToken.mockResolvedValueOnce(
      ticketFor({
        email: 'someone@archive.com',
        email_verified: false,
        sub: 'google-sub-789',
      })
    );

    const res = await request(app)
      .post('/api/auth/google')
      .send({ idToken: 'fake-id-token' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when the request body is missing idToken', async () => {
    const res = await request(app).post('/api/auth/google').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // verifyIdToken must not have been called — zod rejected before we got there.
    expect(verifyIdToken).not.toHaveBeenCalled();
  });
});
