import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
        hd: 'archive.com',
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

// ── Audit B6: M9 / L8 ───────────────────────────────────────────────────────
describe('POST /api/auth/google — allowlist, hd, admin promotion (M9/L8)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  const saved = { allowed: process.env.ALLOWED_USERS, admins: process.env.ADMIN_EMAILS };

  function workspaceTicket(email: string, extra: Record<string, unknown> = {}) {
    return ticketFor({ email, email_verified: true, hd: 'archive.com', sub: `sub-${email}`, ...extra });
  }
  function userRow(email: string, role = 'recruiter') {
    return { id: `id-${email}`, email, name: null, avatarUrl: null, googleId: `sub-${email}`, role, createdAt: new Date() };
  }

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    verifyIdToken.mockReset();
    delete process.env.ALLOWED_USERS;
    delete process.env.ADMIN_EMAILS;
    app = await loadApp();
  });

  afterEach(() => {
    for (const [k, v] of [['ALLOWED_USERS', saved.allowed], ['ADMIN_EMAILS', saved.admins]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('rejects an @archive.com email whose token has no hd claim (consumer Google account)', async () => {
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('someone@archive.com', { hd: undefined }));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(403);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a token whose hd is a different Workspace domain', async () => {
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('someone@archive.com', { hd: 'evil.com' }));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(403);
  });

  it('with ALLOWED_USERS unset, any @archive.com Workspace account may sign in (existing users keep access)', async () => {
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.update.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(200);
  });

  it('with ALLOWED_USERS set, rejects a Workspace account that is not listed', async () => {
    process.env.ALLOWED_USERS = 'sofia@archive.com, andriy.korzhenevskyy@archive.com';
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('random.employee@archive.com'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not authorized/i);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('with ALLOWED_USERS set, accepts a listed user case-insensitively', async () => {
    process.env.ALLOWED_USERS = 'Sofia@Archive.com';
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('sofia@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(userRow('sofia@archive.com', 'admin'));
    mockPrisma.user.update.mockResolvedValueOnce(userRow('sofia@archive.com', 'admin'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(200);
  });

  it('ADMIN_EMAILS members are implicitly allowed even when not in ALLOWED_USERS', async () => {
    process.env.ALLOWED_USERS = 'sofia@archive.com';
    process.env.ADMIN_EMAILS = 'andriy.korzhenevskyy@archive.com';
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.update.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com', 'admin'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(200);
  });

  it('no hardcoded ADMIN_EMAILS default: with the env unset, nobody is promoted on login', async () => {
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('andriy@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    mockPrisma.user.create.mockResolvedValueOnce(userRow('andriy@archive.com'));
    const res = await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(res.status).toBe(200);
    expect(mockPrisma.user.create.mock.calls[0][0].data.role).toBeUndefined();
  });

  it('with ADMIN_EMAILS set, an existing recruiter on the list is promoted', async () => {
    process.env.ADMIN_EMAILS = 'andriy.korzhenevskyy@archive.com';
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com'));
    mockPrisma.user.update.mockResolvedValueOnce(userRow('andriy.korzhenevskyy@archive.com', 'admin'));
    await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(mockPrisma.user.update.mock.calls[0][0].data.role).toBe('admin');
  });

  it('never demotes an existing admin who is not on ADMIN_EMAILS', async () => {
    process.env.ADMIN_EMAILS = 'someone.else@archive.com';
    verifyIdToken.mockResolvedValueOnce(workspaceTicket('sofia@archive.com'));
    mockPrisma.user.findUnique.mockResolvedValueOnce(userRow('sofia@archive.com', 'admin'));
    mockPrisma.user.update.mockResolvedValueOnce(userRow('sofia@archive.com', 'admin'));
    await request(app).post('/api/auth/google').send({ idToken: 't' });
    expect(mockPrisma.user.update.mock.calls[0][0].data.role).toBeUndefined();
  });
});
