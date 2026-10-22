import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { InboxView } from '../lib/api';
import { newReplyDelta } from '../lib/inbox';

/** localStorage flag set by DesktopAlertsToggle: '1' = notify while the tab is hidden. */
export const DESKTOP_ALERTS_KEY = 'inbox.desktopAlerts';

export function desktopAlertsEnabled(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_ALERTS_KEY) === '1';
  } catch {
    return false;
  }
}

function notifyDesktop(title: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!document.hidden || !desktopAlertsEnabled()) return;
  try {
    new Notification(title, { tag: 'inbox-new-replies', body: 'Open the Inbox to review them.' });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/**
 * Diffs the inbox counts between polls. New replies → a toast, "(N) Inbox"
 * in the tab title until the recruiter is back (focus / visible / any
 * interaction) and, opted in with the tab hidden, a desktop notification.
 * `scope` (mailbox + role filter) changes re-baseline silently, and so does
 * `resync()` — call it after our own actions that put replies back.
 */
export function useNewReplyAlerts(counts: Record<InboxView, number> | undefined, scope: string): { resync: () => void } {
  const baseline = useRef<{ scope: string; counts: Record<InboxView, number> } | null>(null);
  const skipNext = useRef(false);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    if (!counts) return;
    const prev = baseline.current;
    baseline.current = { scope, counts };
    if (!prev || prev.scope !== scope || skipNext.current) {
      skipNext.current = false;
      return;
    }
    const delta = newReplyDelta(prev.counts, counts);
    if (delta <= 0) return;
    const title = `${delta} new ${delta === 1 ? 'reply' : 'replies'}`;
    toast(title);
    notifyDesktop(title);
    setUnseen((n) => n + delta);
  }, [counts, scope]);

  // Tab title while there are unseen arrivals; restored afterwards.
  const originalTitle = useRef<string | null>(null);
  useEffect(() => {
    if (unseen === 0) return;
    originalTitle.current ??= document.title;
    document.title = `(${unseen}) Inbox`;
  }, [unseen]);
  useEffect(() => {
    if (unseen === 0) return;
    const seen = () => {
      if (document.visibilityState === 'hidden') return;
      setUnseen(0);
    };
    const events = ['focus', 'pointerdown', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, seen);
    document.addEventListener('visibilitychange', seen);
    return () => {
      for (const e of events) window.removeEventListener(e, seen);
      document.removeEventListener('visibilitychange', seen);
    };
  }, [unseen]);
  useEffect(() => {
    if (unseen > 0 || originalTitle.current === null) return;
    document.title = originalTitle.current;
    originalTitle.current = null;
  }, [unseen]);
  useEffect(
    () => () => {
      if (originalTitle.current !== null) document.title = originalTitle.current;
    },
    []
  );

  const resync = useCallback(() => {
    skipNext.current = true;
  }, []);
  return { resync };
}
