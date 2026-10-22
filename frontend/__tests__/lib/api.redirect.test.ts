import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { safeNextPath } from '../../src/lib/auth';

describe('safeNextPath (L17)', () => {
  it('accepts same-origin absolute paths', () => {
    expect(safeNextPath('?next=%2F%3Ftab%3Ddrafts')).toBe('/?tab=drafts');
  });
  it('rejects protocol-relative and absolute URLs (open redirect)', () => {
    expect(safeNextPath('?next=%2F%2Fevil.com')).toBe('/');
    expect(safeNextPath('?next=https%3A%2F%2Fevil.com')).toBe('/');
    expect(safeNextPath('?next=%2F%5Cevil.com')).toBe('/');
  });
  it('defaults to / when absent', () => {
    expect(safeNextPath('')).toBe('/');
  });
});

describe('401 interceptor (L17)', () => {
  const assign = vi.fn();
  const original = window.location;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, pathname: '/', search: '?tab=drafts', assign },
    });
  });
  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: original });
    assign.mockReset();
  });

  it('redirects to /login with ?next= pointing back at the current page', async () => {
    const { handleAuthError } = await import('../../src/lib/api');
    const config = { url: '/drafts', headers: {} } as InternalAxiosRequestConfig;
    const error = new AxiosError('unauthorized', '401', config, null, {
      status: 401,
      data: {},
      config,
      headers: {},
      statusText: 'Unauthorized',
    } as AxiosResponse);
    await expect(handleAuthError(error)).rejects.toBe(error);
    expect(assign).toHaveBeenCalledWith('/login?next=%2F%3Ftab%3Ddrafts');
  });
});
