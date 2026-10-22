import { useEffect, useLayoutEffect, useRef } from 'react';
import { isTypingTarget } from '../lib/shortcuts';

export type CandidateShortcut = 'prev' | 'next' | 'open' | 'close' | 'toggle';

/** The approved Candidates map (R3) — deliberately a subset of the Inbox's. */
export const CANDIDATE_SHORTCUTS: Array<{ id: CandidateShortcut; keys: string[]; label: string }> = [
  { id: 'prev', keys: ['↑'], label: 'Previous candidate' },
  { id: 'next', keys: ['↓'], label: 'Next candidate' },
  { id: 'open', keys: ['↵'], label: 'Open candidate' },
  { id: 'close', keys: ['Esc'], label: 'Close panel' },
  { id: 'toggle', keys: ['X'], label: 'Select / deselect' },
];

const KEYS: Record<string, CandidateShortcut> = {
  ArrowUp: 'prev',
  ArrowDown: 'next',
  Enter: 'open',
  Escape: 'close',
  x: 'toggle',
  X: 'toggle',
};

/** Same window as the shell's `g` + letter navigation (and the Inbox). */
const G_SEQUENCE_MS = 1200;

/** Menus, dialogs, sheets and listboxes own their keys. */
const OVERLAY_SELECTOR = ['menu', 'dialog', 'alertdialog', 'listbox'].map((r) => `[role=${r}]`).join(',');

/**
 * Candidates keyboard map: ↑/↓ move, ↵ opens the side panel, Esc closes it,
 * x toggles the row's checkbox. Nothing fires while typing or inside an
 * overlay; modifier combos (⌘K) stay with the shell.
 */
export function useCandidateShortcuts(handlers: Partial<Record<CandidateShortcut, () => void>>, enabled = true): void {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    let gAt = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const afterG = Date.now() - gAt < G_SEQUENCE_MS;
      gAt = e.key === 'g' && !afterG ? Date.now() : 0;
      if (afterG) return;
      const id = KEYS[e.key];
      if (!id) return;
      if (e.target instanceof HTMLElement && e.target.closest(OVERLAY_SELECTOR)) return;
      // ↵ on a focused button/link/checkbox is that control's own click.
      if (id === 'open' && e.target instanceof HTMLElement && e.target.closest('button,a,[role=checkbox]')) return;
      const fn = ref.current[id];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
