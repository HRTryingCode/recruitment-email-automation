import { useEffect, useLayoutEffect, useRef } from 'react';

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
  | 'palette'
  | 'help';

/** The approved (simplified) map; also rendered by the ? help dialog. */
export const SHORTCUTS: Array<{ id: InboxShortcut; keys: string[]; label: string }> = [
  { id: 'prev', keys: ['↑'], label: 'Previous reply' },
  { id: 'next', keys: ['↓'], label: 'Next reply' },
  { id: 'open', keys: ['↵'], label: 'Open reply' },
  { id: 'edit', keys: ['E'], label: 'Edit draft' },
  { id: 'send', keys: ['⌘', '↵'], label: 'Send' },
  { id: 'undo', keys: ['⌘', 'Z'], label: 'Undo send' },
  { id: 'dismiss', keys: ['D'], label: 'Dismiss' },
  { id: 'snooze', keys: ['S'], label: 'Snooze' },
  { id: 'close', keys: ['Esc'], label: 'Close / back' },
  { id: 'palette', keys: ['⌘', 'K'], label: 'Command palette' },
  { id: 'help', keys: ['?'], label: 'Keyboard shortcuts' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

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
    if (key.toLowerCase() === 'k') return 'palette';
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
    case 'Escape':
      return 'close';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/**
 * Inbox keyboard map. While typing only ⌘↵ (send) and Esc (close) fire;
 * inside menus/dialogs nothing does except the palette toggle.
 */
export function useInboxShortcuts(handlers: Partial<Record<InboxShortcut, () => void>>, enabled = true): void {
  const ref = useRef(handlers);
  useLayoutEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const id = resolve(e);
      if (!id) return;
      if (inOverlay(e.target) && id !== 'palette') return;
      if (isTypingTarget(e.target) && id !== 'send' && id !== 'close') return;
      const fn = ref.current[id];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
