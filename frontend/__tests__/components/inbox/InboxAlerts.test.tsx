// U1b items 4/5 in the page: new replies between polls, and our own undo
// not counting as one.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { draftFor, installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

const ITEMS = [item('d1', 'interested'), item('d2', 'interested')];
const poll = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });

describe('new-reply alerts', () => {
  it('a poll that brings new replies toasts and titles the tab', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = installInbox(ITEMS);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    store.items.push(item('d3', 'needs_review'), item('d4', 'interested'));
    await poll();
    expect(await screen.findByText('2 new replies')).toBeInTheDocument();
    expect(document.title).toBe('(2) Inbox');
  });

  it('undoing our own send does not count as a new reply', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installInbox(ITEMS);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    await user.click(within(pane).getByRole('button', { name: /^Send/ }));
    await screen.findByRole('region', { name: 'Reply to Ben Sample' });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Sample|Example/ })).toHaveLength(1));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await screen.findByText('Send cancelled');
    await poll();
    await waitFor(() => expect(screen.queryByText(/new repl/)).not.toBeInTheDocument());
  });

  it('links to the desktop alerts setting from the rail (the toggle lives in Settings)', async () => {
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission: vi.fn() }));
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested');
    const rail = await screen.findByRole('complementary', { name: 'Inbox' });
    expect(within(rail).getByRole('link', { name: /Desktop alerts/ })).toHaveAttribute('href', '/settings/mailboxes#notifications');
    expect(within(rail).queryByRole('button', { name: /Desktop alerts/ })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('a sent reply that fails later raises an error toast whose Open shows it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installInbox(ITEMS);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    await user.click(within(pane).getByRole('button', { name: /^Send/ }));
    await screen.findByRole('region', { name: 'Reply to Ben Sample' });
    server.use(
      http.get('*/api/drafts/d1', () =>
        HttpResponse.json({ success: true, data: draftFor(ITEMS[0], { status: 'FAILED', sendError: 'Mailbox disconnected' }) })
      )
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(await screen.findByText('Send to Ada Example failed')).toBeInTheDocument();
    expect(screen.getByText('Mailbox disconnected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(search().get('item')).toBe('d1'));
    expect(search().get('view')).toBe('needs_review');
  });
});
