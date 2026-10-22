import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildPrismaMock, resetPrismaMock, type MockPrisma } from '../_setup/mockPrisma';
import { loadApp, bearer } from '../_setup/testApp';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

import { prisma as injected } from '../../src/db/client';
const mockPrisma = injected as unknown as MockPrisma;

describe('GET /api/candidates?lever= (F2)', () => {
  let app: Awaited<ReturnType<typeof loadApp>>;
  beforeEach(async () => {
    resetPrismaMock(mockPrisma);
    mockPrisma.candidate.findMany.mockResolvedValue([]);
    mockPrisma.candidate.count.mockResolvedValue(0);
    app = await loadApp();
  });

  const whereOf = () => mockPrisma.candidate.findMany.mock.calls[0]![0].where;

  it('lever=IN keeps candidates with any Lever opportunity', async () => {
    const res = await request(app).get('/api/candidates?lever=IN').set('Authorization', bearer('u1'));
    expect(res.status).toBe(200);
    expect(whereOf().leverState).toEqual({ in: ['ACTIVE', 'ARCHIVED', 'HIRED'] });
    expect(mockPrisma.candidate.count.mock.calls[0]![0].where.leverState).toEqual({
      in: ['ACTIVE', 'ARCHIVED', 'HIRED'],
    });
  });

  it('lever=NOT_IN keeps candidates checked and not found', async () => {
    await request(app).get('/api/candidates?lever=NOT_IN').set('Authorization', bearer('u1'));
    expect(whereOf().leverState).toBe('NOT_FOUND');
  });

  it('no lever param leaves leverState unfiltered', async () => {
    await request(app).get('/api/candidates').set('Authorization', bearer('u1'));
    expect(whereOf().leverState).toBeUndefined();
  });

  it('rejects an unknown lever value', async () => {
    const res = await request(app).get('/api/candidates?lever=MAYBE').set('Authorization', bearer('u1'));
    expect(res.status).toBe(400);
  });
});
