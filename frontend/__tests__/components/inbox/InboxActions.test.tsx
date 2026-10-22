// R2 inbox actions: one-step send + undo, dismiss reasons, snooze presets,
// 423 lock + override, auto-advance, presence heartbeat, rewrites (msw).
import { http, HttpResponse } from 'msw';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';
import { snoozePresets } from '../../../src/lib/inbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

const ITEMS = [item('d1', 'interested'), item('d2', 'interested'), item('d3', 'interested')];
const posts = (store: { calls: Array<{ method: string; path: string; body: unknown }> }, suffix: string) =>
  store.calls.filter((c) => c.method === 'POST' && c.path.endsWith(suffix));

async function openPane(name = 'Ada Example') {
  return screen.findByRole('region', { name: `Reply to ${name}` });
}

describe('one-step send', () => {
  it('Send schedules with a 10s undo, shows the toast and advances to the next reply', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await user.click(within(pane).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(posts(store, '/d1/send')).toHaveLength(1));
    expect(posts(store, '/d1/send')[0].body).toEqual({ undoSeconds: 10 });
    expect(await screen.findByText('Sending to Ada Example')).toBeInTheDocument();
    expect(screen.getByText(/Sends in 10s/)).toBeInTheDocument();
    expect(await openPane('Ben Sample')).toBeInTheDocument();
    expect(search().get('item')).toBe('d2');
  });

  it('sends the edited body when the reply has unsaved edits', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    const box = within(pane).getByRole('textbox', { name: 'Reply' });
    await user.clear(box);
    await user.type(box, 'Edited reply');
    await user.click(within(pane).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(posts(store, '/d1/send')).toHaveLength(1));
    expect(posts(store, '/d1/send')[0].body).toEqual({ undoSeconds: 10, bodyText: 'Edited reply' });
  });

  it('Undo in the toast cancels the send and reopens the reply', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await openPane()).getByRole('button', { name: /^Send/ }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(posts(store, '/d1/undo-send')).toHaveLength(1));
    expect(await openPane('Ada Example')).toBeInTheDocument();
    expect(search().get('item')).toBe('d1');
  });

  it('⌘↵ sends and ⌘Z undoes', async () => {
    const store = installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await openPane();
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(posts(store, '/d1/send')).toHaveLength(1));
    await openPane('Ben Sample');
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    await waitFor(() => expect(posts(store, '/d1/undo-send')).toHaveLength(1));
  });

  it('⌘↵ sends even while typing in the reply', async () => {
    const store = installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    const box = within(await openPane()).getByRole('textbox', { name: 'Reply' });
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(posts(store, '/d1/send')).toHaveLength(1));
  });

  it('sending the last reply in a view falls back to the previous one', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d3');
    await user.click(within(await openPane('Cy Placeholder')).getByRole('button', { name: /^Send/ }));
    expect(await openPane('Ben Sample')).toBeInTheDocument();
  });

  it('sending the only reply shows inbox zero', async () => {
    installInbox([item('d1', 'interested')]);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await openPane()).getByRole('button', { name: /^Send/ }));
    expect(await screen.findByText('Inbox zero — nothing waiting')).toBeInTheDocument();
    expect(search().get('item')).toBeNull();
  });

  it('has no Approve step anywhere', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await openPane();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });
});

describe('dismiss', () => {
  it.each([
    ['Wrong label', 'wrong_label'],
    ['Spam', 'spam'],
    ['Already handled', 'already_handled'],
    ['Not needed', 'not_needed'],
    ['Other', 'other'],
  ])('"%s" posts reason %s and advances', async (label, reason) => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await openPane()).getByRole('button', { name: /Dismiss/ }));
    await user.click(await screen.findByRole('menuitem', { name: label }));
    await waitFor(() => expect(posts(store, '/d1/dismiss')).toHaveLength(1));
    expect(posts(store, '/d1/dismiss')[0].body).toEqual({ reason });
    expect(await openPane('Ben Sample')).toBeInTheDocument();
  });

  it('D opens the dismiss menu', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await openPane();
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(await screen.findByRole('menuitem', { name: 'Spam' })).toBeInTheDocument();
  });

  it('typing d in the reply does not dismiss', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const box = within(await openPane()).getByRole('textbox', { name: 'Reply' });
    await user.type(box, 'ds');
    expect(screen.queryByRole('menuitem', { name: 'Spam' })).not.toBeInTheDocument();
  });
});

describe('snooze', () => {
  it.each(['Later today', 'Tomorrow 9am ET', 'Next week'])('"%s" posts the preset time and advances', async (label) => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await openPane()).getByRole('button', { name: /Snooze/ }));
    const before = Date.now();
    await user.click(await screen.findByRole('menuitem', { name: label }));
    await waitFor(() => expect(posts(store, '/d1/snooze')).toHaveLength(1));
    const until = new Date((posts(store, '/d1/snooze')[0].body as { until: string }).until).getTime();
    const expected = snoozePresets(new Date(before)).find((p) => p.label === label)!.until.getTime();
    expect(Math.abs(until - expected)).toBeLessThan(5_000);
    expect(await openPane('Ben Sample')).toBeInTheDocument();
  });

  it('custom date snoozes until 9am ET that day', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await openPane()).getByRole('button', { name: /Snooze/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Custom date…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Snooze until' });
    const d = new Date(Date.now() + 5 * 86400_000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: ymd } });
    await user.click(within(dialog).getByRole('button', { name: 'Snooze' }));
    await waitFor(() => expect(posts(store, '/d1/snooze')).toHaveLength(1));
    const until = (posts(store, '/d1/snooze')[0].body as { until: string }).until;
    expect(until.startsWith(ymd)).toBe(true);
    expect(new Date(until).getUTCHours()).toBeGreaterThanOrEqual(13);
  });

  it('S opens the snooze menu', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await openPane();
    fireEvent.keyDown(document.body, { key: 's' });
    expect(await screen.findByRole('menuitem', { name: 'Tomorrow 9am ET' })).toBeInTheDocument();
  });
});

describe('presence lock (423)', () => {
  it('blocks send with an inline alert and "Send anyway" overrides', async () => {
    const store = installInbox(ITEMS);
    let locked = true;
    server.use(
      http.post('*/api/drafts/d1/send', async ({ request }) => {
        const body = (await request.clone().json()) as { override?: boolean };
        if (locked && !body.override) {
          store.calls.push({ method: 'POST', path: '/api/drafts/d1/send', body });
          return HttpResponse.json({ success: false, error: 'Sofia Delgado is editing this draft', lockedBy: 'Sofia Delgado' }, { status: 423 });
        }
        return undefined;
      })
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await user.click(within(pane).getByRole('button', { name: /^Send/ }));
    const alert = await within(pane).findByRole('alert');
    expect(alert).toHaveTextContent('Sofia is editing this reply');
    expect(search().get('item')).toBe('d1');
    locked = false;
    await user.click(within(alert).getByRole('button', { name: 'Send anyway' }));
    await waitFor(() => expect(posts(store, '/d1/send').at(-1)!.body).toEqual({ undoSeconds: 10, override: true }));
    expect(await openPane('Ben Sample')).toBeInTheDocument();
  });

  it('a locked dismiss shows the same alert and override replays the dismiss', async () => {
    const store = installInbox(ITEMS);
    server.use(
      http.post('*/api/drafts/d1/dismiss', async ({ request }) => {
        const body = (await request.clone().json()) as { override?: boolean };
        if (!body.override) return HttpResponse.json({ success: false, lockedBy: 'Sofia Delgado' }, { status: 423 });
        return undefined;
      })
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await user.click(within(pane).getByRole('button', { name: /Dismiss/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Spam' }));
    const alert = await within(pane).findByRole('alert');
    expect(alert).toHaveTextContent('Sofia is editing this reply');
    await user.click(within(alert).getByRole('button', { name: 'Dismiss anyway' }));
    await waitFor(() => expect(posts(store, '/d1/dismiss').at(-1)!.body).toEqual({ reason: 'spam', override: true }));
  });

  it('shows who else is editing in the pane', async () => {
    installInbox(ITEMS);
    server.use(
      http.post('*/api/drafts/:id/presence', () =>
        HttpResponse.json({ success: true, data: { presence: [{ userId: 'u2', name: 'Sofia Delgado', mode: 'editing' }] } })
      )
    );
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    expect(await within(pane).findByText('Sofia editing')).toBeInTheDocument();
  });
});

describe('presence heartbeat', () => {
  it('posts viewing, switches to editing on focus, repeats every 15s and clears on close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const store = installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await waitFor(() => expect(posts(store, '/d1/presence')).toHaveLength(1));
    expect(posts(store, '/d1/presence')[0].body).toEqual({ mode: 'viewing' });

    act(() => within(pane).getByRole('textbox', { name: 'Reply' }).focus());
    await waitFor(() => expect(posts(store, '/d1/presence').at(-1)!.body).toEqual({ mode: 'editing' }));
    const n = posts(store, '/d1/presence').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(posts(store, '/d1/presence').length).toBe(n + 1));

    fireEvent.click(within(pane).getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(store.calls.some((c) => c.method === 'DELETE' && c.path.endsWith('/d1/presence'))).toBe(true)
    );
  });
});

describe('rewrites', () => {
  it('"Shorter" saves unsaved edits first, then rewrites with the instruction', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    const box = within(pane).getByRole('textbox', { name: 'Reply' });
    await user.type(box, ' PS');
    await user.click(within(pane).getByRole('button', { name: 'Shorter' }));
    await waitFor(() => expect(posts(store, '/d1/dictate')).toHaveLength(1));
    const patch = store.calls.find((c) => c.method === 'PATCH');
    expect((patch!.body as { bodyText: string }).bodyText).toMatch(/ PS$/);
    expect(store.calls.indexOf(patch!)).toBeLessThan(store.calls.indexOf(posts(store, '/d1/dictate')[0]));
    expect((posts(store, '/d1/dictate')[0].body as { notes: string }).notes).toMatch(/shorter/i);
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toMatch(/^Rewritten/));
  });

  it('"Regenerate with instruction…" rewrites with the typed instruction', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await user.type(within(pane).getByRole('textbox', { name: 'Regenerate with instruction' }), 'mention the Austin office{Enter}');
    await waitFor(() => expect(posts(store, '/d1/dictate')).toHaveLength(1));
    expect(posts(store, '/d1/dictate')[0].body).toEqual({ notes: 'mention the Austin office' });
  });

  it('Regenerate keeps edits', async () => {
    const store = installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    await user.click(within(pane).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(posts(store, '/d1/regenerate')).toHaveLength(1));
    expect(posts(store, '/d1/regenerate')[0].body).toEqual({ keepEdits: true });
  });
});

describe('keyboard navigation', () => {
  it('↓ / ↑ move between replies and Esc closes the pane', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await openPane();
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(await openPane('Ben Sample')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(await openPane('Ada Example')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(search().get('item')).toBeNull());
  });

  it('↓ then ↵ opens from the list', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(await openPane('Ada Example')).toBeInTheDocument();
  });

  it('E focuses the reply editor', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await openPane();
    fireEvent.keyDown(document.body, { key: 'e' });
    expect(within(pane).getByRole('textbox', { name: 'Reply' })).toHaveFocus();
  });

  it('Esc while typing leaves the editor instead of closing', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    const box = within(await openPane()).getByRole('textbox', { name: 'Reply' });
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).not.toHaveFocus();
    expect(search().get('item')).toBe('d1');
  });
});
