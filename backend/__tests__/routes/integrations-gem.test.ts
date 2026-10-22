import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

const gem = vi.hoisted(() => ({
  buildGemAuthUrl: vi.fn(),
  completeGemAuth: vi.fn(),
  gemConnectionStatus: vi.fn(),
  disconnectGem: vi.fn(),
}));

vi.mock('../../src/services/gem.service', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/gem.service')>(
    '../../src/services/gem.service'
  );
  return { ...actual, ...gem };
});

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
const mockPrisma = injected as unknown as MockPrisma;

const USER = 'ckuser000000000000000001';

describe('Gem integration routes', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;

  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    for (const fn of Object.values(gem)) fn.mockReset();
    process.env.FRONTEND_URL = 'https://app.test';
    app = await loadApp();
  });

  it('connect/status/disconnect require auth', async () => {
    expect((await request(app).get('/api/integrations/gem/connect')).status).toBe(401);
    expect((await request(app).get('/api/integrations/gem/status')).status).toBe(401);
    expect((await request(app).delete('/api/integrations/gem')).status).toBe(401);
  });

  it('GET /connect returns the Gem authorize URL for the calling user', async () => {
    gem.buildGemAuthUrl.mockResolvedValueOnce('https://www.gem.com/oauth/mcp/authorize?x=1');
    const res = await request(app).get('/api/integrations/gem/connect').set('Authorization', bearer(USER));
    expect(res.status).toBe(200);
    expect(res.body.data.authUrl).toBe('https://www.gem.com/oauth/mcp/authorize?x=1');
    expect(gem.buildGemAuthUrl).toHaveBeenCalledWith(USER);
  });

  it('GET /connect: Gem discovery failure is a readable 502', async () => {
    gem.buildGemAuthUrl.mockRejectedValueOnce(new Error('fetch failed'));
    const res = await request(app).get('/api/integrations/gem/connect').set('Authorization', bearer(USER));
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Gem/);
  });

  it('GET /status returns the caller’s connection state', async () => {
    gem.gemConnectionStatus.mockResolvedValueOnce({ status: 'OK', lastError: null, updatedAt: null });
    const res = await request(app).get('/api/integrations/gem/status').set('Authorization', bearer(USER));
    expect(res.body.data).toEqual({ status: 'OK', lastError: null, updatedAt: null });
    expect(gem.gemConnectionStatus).toHaveBeenCalledWith(USER);
  });

  it('DELETE disconnects only the caller', async () => {
    gem.disconnectGem.mockResolvedValueOnce(undefined);
    const res = await request(app).delete('/api/integrations/gem').set('Authorization', bearer(USER));
    expect(res.status).toBe(200);
    expect(gem.disconnectGem).toHaveBeenCalledWith(USER);
  });

  describe('GET /api/integrations/gem/callback (public, state-bound)', () => {
    const state = `gem-${'a'.repeat(64)}.${USER}`;

    it('consumes a gem state and completes auth for the user bound to it', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 1 });
      gem.completeGemAuth.mockResolvedValueOnce(undefined);
      const res = await request(app).get('/api/integrations/gem/callback').query({ code: 'c1', state });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://app.test/?gem=connected');
      expect(gem.completeGemAuth).toHaveBeenCalledWith(USER, 'c1');
      const where = mockPrisma.oAuthState.updateMany.mock.calls[0]![0].where;
      expect(where.state).toBe(state);
    });

    it('rejects an unknown/expired state without exchanging the code', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 0 });
      const res = await request(app).get('/api/integrations/gem/callback').query({ code: 'c1', state });
      expect(res.status).toBe(400);
      expect(gem.completeGemAuth).not.toHaveBeenCalled();
    });

    it('rejects a Gmail (un-prefixed) state', async () => {
      const res = await request(app)
        .get('/api/integrations/gem/callback')
        .query({ code: 'c1', state: `${'a'.repeat(64)}.${USER}` });
      expect(res.status).toBe(400);
      expect(mockPrisma.oAuthState.updateMany).not.toHaveBeenCalled();
    });

    it('the Gmail callback refuses a gem state', async () => {
      const res = await request(app).get('/api/mailboxes/gmail/callback').query({ code: 'c1', state });
      expect(res.status).toBe(400);
      expect(mockPrisma.oAuthState.updateMany).not.toHaveBeenCalled();
    });

    it('user denied at Gem → redirect back with gem=denied', async () => {
      const res = await request(app).get('/api/integrations/gem/callback').query({ error: 'access_denied', state });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://app.test/?gem=denied');
    });

    it('exchange failure → redirect with gem=error (no 500 page)', async () => {
      mockPrisma.oAuthState.updateMany.mockResolvedValueOnce({ count: 1 });
      gem.completeGemAuth.mockRejectedValueOnce(new Error('invalid_grant'));
      const res = await request(app).get('/api/integrations/gem/callback').query({ code: 'c1', state });
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('https://app.test/?gem=error');
    });
  });
});
