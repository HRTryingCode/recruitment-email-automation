import { describe, it, expect } from 'vitest';
import { safeError, isAuthRevokedError, MailboxNeedsReauthError } from '../../src/lib/safeError';

// Shape of a real GaxiosError thrown by google-auth-library when a refresh
// token has been revoked. `config.data` carries the refresh_token and
// client_secret in the request body — exactly what M7 found leaking into
// Vercel logs via console.error(err).
function fakeInvalidGrant(): Error {
  const err = new Error('invalid_grant') as Error & Record<string, unknown>;
  err.name = 'GaxiosError';
  err.code = '400';
  err.status = 400;
  err.config = {
    url: 'https://oauth2.googleapis.com/token',
    data: 'refresh_token=1//0SECRET-REFRESH&client_secret=GOCSPX-shh&grant_type=refresh_token',
    headers: { Authorization: 'Bearer ya29.SECRET-ACCESS' },
  };
  err.response = {
    status: 400,
    data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
    config: err.config,
  };
  return err;
}

function fakeGmail401(): Error {
  const err = new Error('Invalid Credentials') as Error & Record<string, unknown>;
  err.name = 'GaxiosError';
  err.code = 401;
  err.status = 401;
  err.response = { status: 401, data: { error: { code: 401, message: 'Invalid Credentials' } } };
  return err;
}

describe('safeError', () => {
  it('keeps only name, message, code and status — never config/response', () => {
    const out = safeError(fakeInvalidGrant());
    expect(out).toEqual({ name: 'GaxiosError', message: 'invalid_grant', code: '400', status: 400 });
    const s = JSON.stringify(out);
    expect(s).not.toContain('SECRET');
    expect(s).not.toContain('GOCSPX');
  });

  it('scrubs token-shaped substrings that end up inside messages', () => {
    const err = new Error('request failed: refresh_token=1//0abcDEF123 access ya29.a0AfH6SMB-xyz');
    const out = safeError(err);
    expect(out.message).not.toMatch(/1\/\/0abc/);
    expect(out.message).not.toMatch(/ya29\.a0/);
    expect(out.message).toContain('[REDACTED]');
  });

  it('truncates very long messages', () => {
    const out = safeError(new Error('x'.repeat(5000)));
    expect(out.message.length).toBeLessThanOrEqual(520);
  });

  it('handles non-Error throwables', () => {
    expect(safeError('boom').message).toBe('boom');
    expect(safeError(undefined).message).toBe('undefined');
    expect(safeError({ foo: 1 }).message).toBe('[object Object]');
  });
});

describe('isAuthRevokedError', () => {
  it('detects invalid_grant from the token endpoint', () => {
    expect(isAuthRevokedError(fakeInvalidGrant())).toBe(true);
  });

  it('detects a 401 from the Gmail API', () => {
    expect(isAuthRevokedError(fakeGmail401())).toBe(true);
  });

  it('detects MailboxNeedsReauthError', () => {
    expect(isAuthRevokedError(new MailboxNeedsReauthError('a@archive.com'))).toBe(true);
  });

  it('ignores ordinary failures (503, 404, generic errors)', () => {
    const e503 = Object.assign(new Error('Backend Error'), { code: 503, status: 503 });
    const e404 = Object.assign(new Error('Not Found'), { code: 404 });
    expect(isAuthRevokedError(e503)).toBe(false);
    expect(isAuthRevokedError(e404)).toBe(false);
    expect(isAuthRevokedError(new Error('Gmail 503'))).toBe(false);
    expect(isAuthRevokedError(null)).toBe(false);
  });
});

describe('MailboxNeedsReauthError', () => {
  it('is an operational 409 so the error middleware surfaces the reconnect message', () => {
    const err = new MailboxNeedsReauthError('a@archive.com');
    expect(err.statusCode).toBe(409);
    expect(err.isOperational).toBe(true);
    expect(err.message).toMatch(/a@archive\.com.*reconnected/);
  });
});
