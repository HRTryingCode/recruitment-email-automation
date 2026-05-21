import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { requireAuth } from '../../src/middleware/requireAuth';
import { issueToken } from '../../src/services/auth.service';

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res as Response);
  res.json = vi.fn().mockReturnValue(res as Response);
  return res as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

function makeReq(headers: Record<string, string | undefined> = {}) {
  return { headers } as unknown as Request;
}

describe('middleware/requireAuth', () => {
  let next: NextFunction & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn() as unknown as typeof next;
  });

  it('calls next() and sets req.userId for a valid bearer token', () => {
    const token = issueToken('user-42');
    const req = makeReq({ authorization: `Bearer ${token}` });
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe('user-42');
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('accepts a lowercase "bearer" prefix', () => {
    const token = issueToken('user-case');
    const req = makeReq({ authorization: `bearer ${token}` });
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.userId).toBe('user-case');
  });

  it('returns 401 when the Authorization header is missing', () => {
    const req = makeReq({});
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('returns 401 when the header is malformed (no Bearer prefix)', () => {
    const req = makeReq({ authorization: 'Basic dXNlcjpwYXNz' });
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the bearer token is empty', () => {
    const req = makeReq({ authorization: 'Bearer ' });
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
  });

  it('returns 401 when the token is invalid', () => {
    const req = makeReq({ authorization: 'Bearer not-a-real-token' });
    const res = makeRes();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringMatching(/invalid|expired/i),
      })
    );
  });
});
