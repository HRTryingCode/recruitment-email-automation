import { useEffect, useRef, useState } from 'react';
import { clearDraftPresence, heartbeatDraftPresence, type DraftPresenceEntry, type PresenceMode } from '../lib/api';
import { getToken } from '../lib/auth';

export const PRESENCE_INTERVAL_MS = 15_000;

/** Release presence while the page is going away (axios can't outlive it). */
function releaseOnUnload(draftId: string): void {
  try {
    const base = import.meta.env.VITE_API_URL ?? '/api';
    const token = getToken();
    void fetch(`${base}/drafts/${draftId}/presence`, {
      method: 'DELETE',
      keepalive: true,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).catch(() => undefined);
  } catch {
    // best-effort; the server expires presence after 45s anyway
  }
}

/**
 * Heartbeat presence for the open draft every 15s (`editing` while the
 * editor is focused or dirty), clear it when the draft closes or the page
 * unloads, and return the other people on the draft.
 */
export function useDraftPresence(draftId: string | undefined, mode: PresenceMode): DraftPresenceEntry[] {
  const [presence, setPresence] = useState<DraftPresenceEntry[]>([]);
  const modeRef = useRef(mode);
  const beatRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!draftId) return;
    let alive = true;
    const beat = () => {
      heartbeatDraftPresence(draftId, modeRef.current)
        .then((r) => {
          if (alive) setPresence(r.data.presence);
        })
        .catch(() => undefined);
    };
    beatRef.current = beat;
    beat();
    const timer = window.setInterval(beat, PRESENCE_INTERVAL_MS);
    const onHide = () => releaseOnUnload(draftId);
    window.addEventListener('pagehide', onHide);
    return () => {
      alive = false;
      beatRef.current = () => undefined;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onHide);
      setPresence([]);
      clearDraftPresence(draftId).catch(() => undefined);
    };
  }, [draftId]);

  // Mode flips (viewing ⇄ editing) are announced right away.
  useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    beatRef.current();
  }, [mode]);

  return presence;
}
