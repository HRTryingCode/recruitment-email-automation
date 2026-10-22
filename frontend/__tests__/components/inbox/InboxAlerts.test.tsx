// U1b items 4/5 in the page: new replies between polls, and our own undo
// not counting as one.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox } from './renderInbox';

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

  it('offers desktop alerts in the rail', async () => {
    vi.stubGlobal('Notification', Object.assign(vi.fn(), { permission: 'default', requestPermission: vi.fn() }));
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested');
    const rail = await screen.findByRole('complementary', { name: 'Inbox' });
    expect(within(rail).getByRole('button', { name: /Desktop alerts/ })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
