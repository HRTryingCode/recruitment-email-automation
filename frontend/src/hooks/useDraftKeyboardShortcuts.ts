import { useEffect } from 'react';

export type DraftShortcutAction =
  | 'next'
  | 'prev'
  | 'open'
  | 'close'
  | 'approve'
  | 'discard'
  | 'regenerate'
  | 'edit';

export interface DraftShortcutHandlers {
  onNext?: () => void;
  onPrev?: () => void;
  onOpen?: () => void;
  onClose?: () => void;
  onApprove?: () => void;
  onDiscard?: () => void;
  onRegenerate?: () => void;
  onEdit?: () => void;
}

interface Options {
  enabled?: boolean;
}

function isTypingInEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function isBlockingDialogOpen(paneSelector: string): boolean {
  if (typeof document === 'undefined') return false;
  // Any open Radix dialog/alertdialog/dropdown that isn't our own side-pane
  // would mean the user is mid-confirmation; pause shortcuts.
  const open = document.querySelectorAll('[role="alertdialog"], [data-state="open"][role="dialog"]');
  for (const el of Array.from(open)) {
    if (paneSelector && (el.matches(paneSelector) || el.closest(paneSelector))) {
      continue;
    }
    return true;
  }
  return false;
}

const PANE_SELECTOR = '[data-draft-pane="true"]';

/**
 * Global keydown shortcuts for the drafts triage flow.
 *
 * Disabled when typing into an input/textarea, and when a non-pane Radix
 * dialog is open (e.g. the discard-confirm AlertDialog) — the dialog gets
 * to consume the keystroke instead.
 */
export function useDraftKeyboardShortcuts(
  handlers: DraftShortcutHandlers,
  options: Options = {}
) {
  const { enabled = true } = options;

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingInEditable(e.target)) return;
      if (isBlockingDialogOpen(PANE_SELECTOR)) return;

      // Don't fire on modified keystrokes — leave them for browser/system.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      // Navigation
      if (key === 'j' || key === 'ArrowDown') {
        if (handlers.onNext) {
          e.preventDefault();
          handlers.onNext();
        }
        return;
      }
      if (key === 'k' || key === 'ArrowUp') {
        if (handlers.onPrev) {
          e.preventDefault();
          handlers.onPrev();
        }
        return;
      }
      if (key === 'Enter' || key === 'o') {
        if (handlers.onOpen) {
          e.preventDefault();
          handlers.onOpen();
        }
        return;
      }
      if (key === 'Escape') {
        if (handlers.onClose) {
          // Don't preventDefault — let other Escape handlers (Radix) also run.
          handlers.onClose();
        }
        return;
      }

      // Single-letter actions — only apply when pane is open
      // (handler authors decide; we just guard typing/dialog above).
      if (key === 'a') {
        if (handlers.onApprove) {
          e.preventDefault();
          handlers.onApprove();
        }
        return;
      }
      if (key === 'x' || key === 'd') {
        if (handlers.onDiscard) {
          e.preventDefault();
          handlers.onDiscard();
        }
        return;
      }
      if (key === 'r') {
        if (handlers.onRegenerate) {
          e.preventDefault();
          handlers.onRegenerate();
        }
        return;
      }
      if (key === 'e') {
        if (handlers.onEdit) {
          e.preventDefault();
          handlers.onEdit();
        }
        return;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, handlers]);
}

export const DRAFT_PANE_DATA_ATTR = { 'data-draft-pane': 'true' } as const;
