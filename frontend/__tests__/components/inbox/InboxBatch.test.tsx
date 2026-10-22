// R2 inbox: batch send for Not interested, ? help, ⌘K palette (msw).
import { http, HttpResponse } from 'msw';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

const NI = [item('d3', 'not_interested'), item('d4', 'not_interested'), item('d5', 'not_interested')];

describe('batch send (Not interested)', () => {
  it('only offers checkboxes in the Not interested view', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    expect(screen.queryByRole('checkbox', { name: /Select/ })).not.toBeInTheDocument();
  });

  it('selected replies go out in one batch after a review dialog', async () => {
    const store = installInbox(NI);
    const user = userEvent.setup();
    renderInbox('/inbox?view=not_interested');
    await user.click(await screen.findByRole('checkbox', { name: 'Select Cy Placeholder' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Dee Fixture' }));
    await user.click(screen.getByRole('button', { name: 'Send 2 replies' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send 2 replies' });
    expect(within(dialog).getByText('Cy Placeholder')).toBeInTheDocument();
    expect(within(dialog).getByText('Dee Fixture')).toBeInTheDocument();
    expect(within(dialog).queryByText('Eli Mock')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send 2 replies' }));
    await waitFor(() => expect(store.calls.some((c) => c.path.endsWith('/batch-send'))).toBe(true));
    expect(store.calls.find((c) => c.path.endsWith('/batch-send'))!.body).toEqual({ draftIds: ['d3', 'd4'], undoSeconds: 10 });
    expect(await screen.findByText('Sending 2 replies')).toBeInTheDocument();
  });

  it('Select all picks every reply in the view', async () => {
    installInbox(NI);
    const user = userEvent.setup();
    renderInbox('/inbox?view=not_interested');
    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Send 3 replies' })).toBeInTheDocument();
  });

  it('reports skipped and locked replies', async () => {
    const store = installInbox(NI);
    server.use(
      http.post('*/api/drafts/batch-send', async ({ request }) => {
        store.calls.push({ method: 'POST', path: '/api/drafts/batch-send', body: await request.clone().json() });
        return HttpResponse.json(
          {
            success: true,
            data: {
              scheduled: ['d3'],
              skipped: [
                { id: 'd4', reason: 'locked', lockedBy: 'Sofia Delgado' },
                { id: 'd5', reason: 'not_pending' },
              ],
              scheduledSendAt: new Date().toISOString(),
              undoSeconds: 10,
            },
          },
          { status: 202 }
        );
      })
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=not_interested');
    await user.click(await screen.findByRole('checkbox', { name: 'Select all' }));
    await user.click(screen.getByRole('button', { name: 'Send 3 replies' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send 3 replies' });
    await user.click(within(dialog).getByRole('button', { name: 'Send 3 replies' }));
    const result = await screen.findByRole('dialog', { name: '1 sent, 2 skipped' });
    expect(within(result).getByText(/Dee Fixture — Sofia is editing/)).toBeInTheDocument();
    expect(within(result).getByText(/Eli Mock — already handled/)).toBeInTheDocument();
  });

  it('Undo on a batch cancels every scheduled reply', async () => {
    const store = installInbox(NI);
    const user = userEvent.setup();
    renderInbox('/inbox?view=not_interested');
    await user.click(await screen.findByRole('checkbox', { name: 'Select Cy Placeholder' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Dee Fixture' }));
    await user.click(screen.getByRole('button', { name: 'Send 2 replies' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send 2 replies' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(store.calls.filter((c) => c.path.endsWith('/undo-send'))).toHaveLength(2));
  });
});

describe('help and palette', () => {
  it('? opens the shortcut help', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    const help = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(help).getByText('Send')).toBeInTheDocument();
    expect(within(help).getByText('Undo send')).toBeInTheDocument();
  });

  it('⌘K opens the palette and runs a view switch', async () => {
    installInbox([item('d1', 'interested')]);
    const user = userEvent.setup();
    renderInbox('/inbox');
    await screen.findByRole('navigation', { name: 'Inbox views' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    await user.click(await screen.findByRole('option', { name: /Go to Interested/ }));
    await waitFor(() => expect(search().get('view')).toBe('interested'));
  });
});
