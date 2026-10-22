// U1b item 5: new replies between polls → toast, "(N) Inbox" tab title and,
// when opted in and the tab is hidden, a desktop notification.
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../../src/components/ui/sonner';
import { DESKTOP_ALERTS_KEY, useNewReplyAlerts } from '../../src/hooks/useNewReplyAlerts';
import type { InboxView } from '../../src/lib/api';

type Counts = Record<InboxView, number>;
const counts = (n: number, i = 0, x = 0): Counts => ({ needs_review: n, interested: i, not_interested: x, snoozed: 0, sent_today: 0 });

function setup(initial: Counts | undefined, scope = 'mb:all') {
  render(<Toaster />);
  return renderHook(({ c, s }: { c: Counts | undefined; s: string }) => useNewReplyAlerts(c, s), {
    initialProps: { c: initial, s: scope },
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
}

describe('useNewReplyAlerts', () => {
  beforeEach(() => {
    document.title = 'Archive Recruiting AI';
    setHidden(false);
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('says nothing on the first load', () => {
    setup(counts(3));
    expect(screen.queryByText(/new repl/)).not.toBeInTheDocument();
    expect(document.title).toBe('Archive Recruiting AI');
  });

  it('toasts and titles the tab when replies arrive between polls', async () => {
    const { rerender } = setup(counts(1, 1));
    rerender({ c: counts(2, 2), s: 'mb:all' });
    expect(await screen.findByText('2 new replies')).toBeInTheDocument();
    expect(document.title).toBe('(2) Inbox');
    rerender({ c: counts(3, 2), s: 'mb:all' });
    expect(await screen.findByText('1 new reply')).toBeInTheDocument();
    expect(document.title).toBe('(3) Inbox');
  });

  it('clears the tab count once the recruiter is back', async () => {
    const { rerender } = setup(counts(1));
    rerender({ c: counts(2), s: 'mb:all' });
    expect(document.title).toBe('(1) Inbox');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(document.title).toBe('Archive Recruiting AI');
  });

  it('restores the page title on unmount', () => {
    const { rerender, unmount } = setup(counts(1));
    rerender({ c: counts(2), s: 'mb:all' });
    unmount();
    expect(document.title).toBe('Archive Recruiting AI');
  });

  it('a scope change (mailbox / role filter) re-baselines without alerting', () => {
    const { rerender } = setup(counts(1));
    rerender({ c: counts(9), s: 'mb:mb2' });
    expect(screen.queryByText(/new repl/)).not.toBeInTheDocument();
    expect(document.title).toBe('Archive Recruiting AI');
  });

  it('resync() swallows the next change (our own undo / restore)', () => {
    const { result, rerender } = setup(counts(1));
    act(() => result.current.resync());
    rerender({ c: counts(2), s: 'mb:all' });
    expect(screen.queryByText(/new repl/)).not.toBeInTheDocument();
  });

  it('sends a desktop notification only when opted in, granted and the tab is hidden', () => {
    const Notif = vi.fn();
    vi.stubGlobal('Notification', Object.assign(Notif, { permission: 'granted' }));
    const { rerender } = setup(counts(1));
    rerender({ c: counts(2), s: 'mb:all' });
    expect(Notif).not.toHaveBeenCalled(); // visible, not opted in
    window.localStorage.setItem(DESKTOP_ALERTS_KEY, '1');
    setHidden(true);
    rerender({ c: counts(4), s: 'mb:all' });
    expect(Notif).toHaveBeenCalledWith('2 new replies', expect.objectContaining({ tag: 'inbox-new-replies' }));
  });
});
