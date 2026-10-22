/** True when a keystroke is going into a text field (don't hijack it). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

const OPEN_SHORTCUTS_EVENT = 'archive:open-shortcuts';

/** Open the global shortcut help (used by the ⌘K "Show shortcuts" action). */
export function openShortcuts(): void {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}

export function onOpenShortcuts(handler: () => void): () => void {
  window.addEventListener(OPEN_SHORTCUTS_EVENT, handler);
  return () => window.removeEventListener(OPEN_SHORTCUTS_EVENT, handler);
}

/** Current theme from the <html> class (lib/theme.ts keeps it in sync). */
export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
