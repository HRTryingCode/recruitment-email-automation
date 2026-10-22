import { useEffect, useSyncExternalStore } from 'react';

/** The candidate the current screen is showing, offered by ⌘K as "Open candidate". */
export interface PaletteCandidate {
  id: string;
  name: string;
}

let current: PaletteCandidate | null = null;
const listeners = new Set<() => void>();

function set(next: PaletteCandidate | null): void {
  if (current?.id === next?.id && current?.name === next?.name) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Publish `candidate` to the palette while the caller is mounted. */
export function usePublishPaletteCandidate(candidate: PaletteCandidate | null): void {
  const id = candidate?.id;
  const name = candidate?.name;
  useEffect(() => {
    set(id && name ? { id, name } : null);
  }, [id, name]);
  useEffect(() => () => set(null), []);
}

export function usePaletteCandidate(): PaletteCandidate | null {
  return useSyncExternalStore(subscribe, () => current);
}
