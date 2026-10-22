import { useCallback, useEffect, useRef } from 'react';
import { fetchDraft } from '../lib/api';
import { toastError } from '../lib/toast';

/** How often a watched send is re-checked, and for how long. */
export const SEND_WATCH_MS = 5_000;
export const SEND_WATCH_TIMEOUT_MS = 180_000;

/** Statuses after which the send is settled one way or the other. */
const SETTLED = new Set(['SENT', 'PENDING', 'DISCARDED']);

interface Watched {
  name: string;
  until: number;
}

/**
 * Follows replies we just sent until they leave or fail. A send that turns
 * FAILED is never silent: an error toast names the candidate, says why, and
 * offers Open. Undone (PENDING), dismissed and sent replies stop watching.
 */
export function useSendWatch(onOpen: (draftId: string) => void, onFailed?: () => void) {
  const watched = useRef(new Map<string, Watched>());
  const timer = useRef<number | null>(null);
  const handlers = useRef({ onOpen, onFailed });
  useEffect(() => {
    handlers.current = { onOpen, onFailed };
  });

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const busy = useRef(false);
  const check = useCallback(async () => {
    if (busy.current) return; // a slow round is still out: don't double-toast
    busy.current = true;
    const now = Date.now();
    await Promise.all(
      [...watched.current].map(async ([id, w]) => {
        if (now > w.until) {
          watched.current.delete(id);
          return;
        }
        try {
          const { data } = await fetchDraft(id);
          if (data.status === 'FAILED') {
            watched.current.delete(id);
            toastError(`Send to ${w.name} failed`, data.sendError ?? 'Check Gmail Sent before retrying.', {
              label: 'Open',
              onClick: () => handlers.current.onOpen(id),
            });
            handlers.current.onFailed?.();
          } else if (SETTLED.has(data.status)) {
            watched.current.delete(id);
          }
        } catch {
          // Transient: try again next tick (until the timeout).
        }
      })
    );
    busy.current = false;
    if (watched.current.size === 0) stop();
  }, [stop]);

  const watch = useCallback(
    (sends: Array<{ id: string; name: string }>) => {
      const until = Date.now() + SEND_WATCH_TIMEOUT_MS;
      for (const s of sends) watched.current.set(s.id, { name: s.name, until });
      if (timer.current === null && watched.current.size > 0) {
        timer.current = window.setInterval(() => void check(), SEND_WATCH_MS);
      }
    },
    [check]
  );

  useEffect(() => stop, [stop]);
  return { watch };
}
