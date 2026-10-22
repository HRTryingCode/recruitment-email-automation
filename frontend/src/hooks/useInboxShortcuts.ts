import { useEffect, useLayoutEffect, useRef } from 'react';
import { isTypingTarget } from '../lib/shortcuts';

export type InboxShortcut =
  | 'prev'
  | 'next'
  | 'open'
  | 'edit'
  | 'send'
  | 'undo'
  | 'dismiss'
  | 'snooze'
  | 'close'
  | 'interested'
  | 'not_interested';

/** The approved (simplified) map; also rendered by the shell's ? dialog. */
export const SHORTCUTS: Array<{ id: InboxShortcut; keys: string[]; label: string }> = [
  { id: 'prev', keys: ['↑'], label: 'Previous reply' },
  { id: 'next', keys: ['↓'], label: 'Next reply' },
  { id: 'open', keys: ['↵'], label: 'Open reply' },
  { id: 'edit', keys: ['E'], label: 'Edit draft' },
  { id: 'send', keys: ['⌘', '↵'], label: 'Send' },
  { id: 'undo', keys: ['⌘', 'Z'], label: 'Undo send' },
  { id: 'dismiss', keys: ['D'], label: 'Dismiss reply · Hide candidate' },
  { id: 'snooze', keys: ['S'], label: 'Snooze reply' },
  { id: 'interested', keys: ['I'], label: 'Reply as Interested (no draft yet)' },
  { id: 'not_interested', keys: ['N'], label: 'Reply as Not interested (no draft yet)' },
  { id: 'close', keys: ['Esc'], label: 'Close / back' },
];

/** The shell's `g` + letter navigation (ShortcutsDialog) waits this long for the letter. */
const G_SEQUENCE_MS = 1200;

/** Menus, dialogs and listboxes own their keys (arrows, Enter, typeahead). */
const OVERLAY_SELECTOR = ['menu', 'dialog', 'alertdialog', 'listbox'].map((r) => `[role=${r}]`).join(',');

function inOverlay(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(OVERLAY_SELECTOR);
}

function resolve(e: KeyboardEvent): InboxShortcut | null {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key;
  if (mod) {
    if (key === 'Enter') return 'send';
    if (key.toLowerCase() === 'z' && !e.shiftKey) return 'undo';
    return null;
  }
  if (e.altKey) return null;
  switch (key) {
    case 'ArrowDown':
    case 'j':
      return 'next';
    case 'ArrowUp':
    case 'k':
      return 'prev';
    case 'Enter':
      return 'open';
    case 'e':
    case 'E':
      return 'edit';
    case 'd':
    case 'D':
      return 'dismiss';
    case 's':
    case 'S':
      return 'snooze';
    case 'i':
    case 'I':
      return 'interested';
    case 'n':
    case 'N':
      return 'not_interested';
    case 'Escape':
      return 'close';
    default:
      return null;
  }
}

/**
 * Inbox keyboard map. While typing only ⌘↵ (send) and Esc (close) fire;
 * inside menus/dialogs nothing does. ⌘K stays with the shell palette, and
 * the key right after `g` is left to the shell's g-navigation (g s =
 * Settings, not Snooze). `?` is left to the shell's one shortcuts dialog.
 * `allowWhileTyping` lets a shortcut
 * through from a text field when it says so (⌘Z undo-send from a clean editor).
 */
export function useInboxShortcuts(
  handlers: Partial<Record<InboxShortcut, () => void>>,
  enabled = true,
  allowWhileTyping?: (id: InboxShortcut) => boolean
): void {
  const ref = useRef(handlers);
  const allowRef = useRef(allowWhileTyping);
  useLayoutEffect(() => {
    ref.current = handlers;
    allowRef.current = allowWhileTyping;
  });

  useEffect(() => {
    if (!enabled) return;
    let gAt = 0;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        const afterG = Date.now() - gAt < G_SEQUENCE_MS;
        gAt = e.key === 'g' && !afterG ? Date.now() : 0;
        if (afterG) return;
      }
      const id = resolve(e);
      if (!id) return;
      if (inOverlay(e.target)) return;
      if (isTypingTarget(e.target) && id !== 'send' && id !== 'close' && !allowRef.current?.(id)) return;
      const fn = ref.current[id];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
