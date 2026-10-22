// H3: connect Gem from inside the Add to Lever dialog without losing it.
// Gem's OAuth callback (backend app.ts) redirects to the SPA with
// `?gem=connected|error|denied`. In a popup, that page relays the result to
// the dialog and closes; in a normal tab (the account-menu flow) it just
// cleans the URL so main.tsx can toast.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGemStatus, startGemConnect } from './leverApi';
import { extractApiErrorMessage } from './toast';

export const GEM_OAUTH_MESSAGE = 'gem-oauth';
export const GEM_POPUP_NAME = 'gem-oauth';

export type GemOAuthResult = 'connected' | 'error' | 'denied';
type GemOAuthMessage = { type: typeof GEM_OAUTH_MESSAGE; result: GemOAuthResult };

const RESULTS: readonly GemOAuthResult[] = ['connected', 'error', 'denied'];

function isGemMessage(data: unknown): data is GemOAuthMessage {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as GemOAuthMessage).type === GEM_OAUTH_MESSAGE &&
    RESULTS.includes((data as GemOAuthMessage).result)
  );
}

/**
 * Run once at boot, before React renders. Returns null when this page isn't
 * a Gem OAuth return; otherwise the result and whether the window closed
 * itself (a popup) — when it didn't, the caller shows a toast.
 */
export function handleGemOAuthReturn(win: Window = window): { result: GemOAuthResult; closed: boolean } | null {
  const url = new URL(win.location.href);
  const raw = url.searchParams.get('gem');
  if (raw === null) return null;
  const result: GemOAuthResult = (RESULTS as readonly string[]).includes(raw) ? (raw as GemOAuthResult) : 'error';
  url.searchParams.delete('gem');
  win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`);

  const msg: GemOAuthMessage = { type: GEM_OAUTH_MESSAGE, result };
  try {
    (win.opener as Window | null)?.postMessage(msg, url.origin);
  } catch {
    // Opener gone or cross-origin; BroadcastChannel / status polling cover it.
  }
  try {
    const bc = new BroadcastChannel(GEM_OAUTH_MESSAGE);
    bc.postMessage(msg);
    bc.close();
  } catch {
    // BroadcastChannel unavailable (old browser, jsdom).
  }
  // Only close a window we opened; never the recruiter's own tab.
  const isPopup = !!win.opener || win.name === GEM_POPUP_NAME;
  if (isPopup) win.close();
  return { result, closed: isPopup };
}

const ERRORS: Record<Exclude<GemOAuthResult, 'connected'>, string> = {
  denied: 'Gem connection was cancelled.',
  error: 'Gem connection failed. Try again.',
};

interface Options {
  onConnected: () => void;
  /** Tests inject these. */
  openWindow?: typeof window.open;
  navigate?: (url: string) => void;
  pollMs?: number;
  timeoutMs?: number;
}

/**
 * Starts the Gem OAuth in a popup and reports back when it's done: on the
 * callback page's postMessage / BroadcastChannel, or — if the browser cut
 * the opener link — by polling /api/integrations/gem/status every 2s for up
 * to 2 minutes. A blocked popup falls back to the full-page redirect.
 */
export function useGemConnectPopup({
  onConnected,
  openWindow = (...args) => window.open(...args),
  navigate = (url) => window.location.assign(url),
  pollMs = 2000,
  timeoutMs = 120_000,
}: Options) {
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;

  const stop = useCallback(() => {
    cleanup.current?.();
    cleanup.current = null;
    setWaiting(false);
  }, []);

  useEffect(() => () => cleanup.current?.(), []);

  const connect = useCallback(() => {
    cleanup.current?.();
    setError(null);
    // Open synchronously inside the click so popup blockers allow it; the
    // authorize URL arrives a moment later.
    const popup = openWindow('about:blank', GEM_POPUP_NAME, 'popup,width=520,height=720');
    setWaiting(true);

    let done = false;
    const finish = (result: GemOAuthResult) => {
      if (done) return;
      done = true;
      stop();
      if (result === 'connected') onConnectedRef.current();
      else setError(ERRORS[result]);
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && isGemMessage(e.data)) finish(e.data.result);
    };
    window.addEventListener('message', onMessage);
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(GEM_OAUTH_MESSAGE);
      bc.onmessage = (e) => {
        if (isGemMessage(e.data)) finish(e.data.result);
      };
    } catch {
      bc = null;
    }
    const poll = setInterval(() => {
      void fetchGemStatus()
        .then((s) => {
          if (s.status === 'OK') finish('connected');
          else if (popup?.closed) {
            // Closed without finishing: stop quietly.
            done = true;
            stop();
          }
        })
        .catch(() => {});
    }, pollMs);
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      stop();
      setError("Gem connection didn't finish. Try again.");
    }, timeoutMs);
    cleanup.current = () => {
      done = true;
      window.removeEventListener('message', onMessage);
      bc?.close();
      clearInterval(poll);
      clearTimeout(timeout);
    };

    startGemConnect()
      .then((url) => {
        if (done) return;
        if (popup) popup.location.href = url;
        else {
          stop();
          navigate(url);
        }
      })
      .catch((err) => {
        popup?.close();
        if (done) return;
        done = true;
        stop();
        setError(extractApiErrorMessage(err, 'Could not start the Gem connection. Try again later.'));
      });
  }, [openWindow, navigate, pollMs, timeoutMs, stop]);

  return { connect, waiting, error };
}
