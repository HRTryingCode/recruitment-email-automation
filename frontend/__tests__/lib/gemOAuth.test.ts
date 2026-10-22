import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as leverApi from '../../src/lib/leverApi';
import { GEM_OAUTH_MESSAGE, GEM_POPUP_NAME, handleGemOAuthReturn, useGemConnectPopup } from '../../src/lib/gemOAuth';

vi.mock('../../src/lib/leverApi', () => ({
  fetchGemStatus: vi.fn(),
  startGemConnect: vi.fn(),
}));
const api = vi.mocked(leverApi);

function fakeWindow(href: string, opts: { opener?: unknown; name?: string } = {}) {
  const replaceState = vi.fn();
  return {
    location: new URL(href),
    history: { state: null, replaceState },
    opener: opts.opener ?? null,
    name: opts.name ?? '',
    close: vi.fn(),
  } as unknown as Window & { close: ReturnType<typeof vi.fn> };
}

describe('handleGemOAuthReturn (the SPA page Gem\'s callback redirects to)', () => {
  it('no ?gem= → does nothing', () => {
    const w = fakeWindow('https://app.test/?tab=candidates');
    expect(handleGemOAuthReturn(w)).toBeNull();
    expect(w.history.replaceState).not.toHaveBeenCalled();
  });

  it('popup: posts the result to the opener (own origin only) and closes itself', () => {
    const opener = { postMessage: vi.fn() };
    const w = fakeWindow('https://app.test/?gem=connected', { opener, name: GEM_POPUP_NAME });
    expect(handleGemOAuthReturn(w)).toEqual({ result: 'connected', closed: true });
    expect(opener.postMessage).toHaveBeenCalledWith({ type: GEM_OAUTH_MESSAGE, result: 'connected' }, 'https://app.test');
    expect(w.close).toHaveBeenCalled();
  });

  it('full-page fallback: strips the param, keeps the rest of the URL, does not close the tab', () => {
    const w = fakeWindow('https://app.test/?gem=error&tab=candidates#x');
    expect(handleGemOAuthReturn(w)).toEqual({ result: 'error', closed: false });
    expect(w.history.replaceState).toHaveBeenCalledWith(null, '', '/?tab=candidates#x');
    expect(w.close).not.toHaveBeenCalled();
  });

  it('an unexpected value is treated as an error', () => {
    expect(handleGemOAuthReturn(fakeWindow('https://app.test/?gem=<script>'))?.result).toBe('error');
  });
});

describe('useGemConnectPopup', () => {
  let popup: { location: { href: string }; closed: boolean; close: ReturnType<typeof vi.fn> };
  let openWindow: ReturnType<typeof vi.fn>;
  const navigate = vi.fn();
  const onConnected = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
    openWindow = vi.fn(() => popup);
    navigate.mockReset();
    onConnected.mockReset();
    api.startGemConnect.mockReset().mockResolvedValue('https://gem.test/authorize?x=1');
    api.fetchGemStatus.mockReset().mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null });
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    return renderHook(() =>
      useGemConnectPopup({ onConnected, openWindow: openWindow as unknown as typeof window.open, navigate })
    );
  }

  it('opens the popup synchronously (no popup blocker), then points it at Gem', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    expect(openWindow).toHaveBeenCalledWith('about:blank', GEM_POPUP_NAME, expect.stringContaining('popup'));
    await act(async () => {});
    expect(popup.location.href).toBe('https://gem.test/authorize?x=1');
    expect(result.current.waiting).toBe(true);
  });

  it('resolves on the callback page\'s postMessage', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: GEM_OAUTH_MESSAGE, result: 'connected' }, origin: window.location.origin }));
    });
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(result.current.waiting).toBe(false);
  });

  it('ignores messages from another origin', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: GEM_OAUTH_MESSAGE, result: 'connected' }, origin: 'https://evil.test' }));
    });
    expect(onConnected).not.toHaveBeenCalled();
  });

  it('falls back to polling /gem/status every 2s', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(2000));
    expect(onConnected).not.toHaveBeenCalled();
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    await act(async () => vi.advanceTimersByTime(2000));
    expect(onConnected).toHaveBeenCalledTimes(1);
    expect(result.current.waiting).toBe(false);
  });

  it('gives up after 2 minutes', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    await act(async () => vi.advanceTimersByTime(120_000));
    expect(result.current.waiting).toBe(false);
    expect(result.current.error).toMatch(/didn.t finish/i);
    const calls = api.fetchGemStatus.mock.calls.length;
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(api.fetchGemStatus.mock.calls.length).toBe(calls);
  });

  it('a denied/failed connect surfaces an error and does not call onConnected', async () => {
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { type: GEM_OAUTH_MESSAGE, result: 'denied' }, origin: window.location.origin }));
    });
    expect(onConnected).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/cancel/i);
  });

  it('popup blocked → full-page redirect to Gem (the account-menu flow)', async () => {
    openWindow.mockReturnValue(null);
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    expect(navigate).toHaveBeenCalledWith('https://gem.test/authorize?x=1');
  });

  it('could not start → closes the blank popup and shows the error', async () => {
    api.startGemConnect.mockRejectedValue(new Error('boom'));
    const { result } = setup();
    act(() => result.current.connect());
    await act(async () => {});
    expect(popup.close).toHaveBeenCalled();
    expect(result.current.waiting).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});
