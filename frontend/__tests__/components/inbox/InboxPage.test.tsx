// R2 inbox: rail, list, reply pane and URL state against the real api.ts (msw).
import { http, HttpResponse } from 'msw';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
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

const ITEMS = [item('d1', 'interested'), item('d2', 'interested'), item('d4', 'not_interested'), item('d5', 'needs_review')];

describe('InboxPage', () => {
  it('shows every view with its count in the rail', async () => {
    installInbox(ITEMS);
    renderInbox();
    const rail = await screen.findByRole('navigation', { name: 'Inbox views' });
    await waitFor(() => expect(within(rail).getByRole('link', { name: /Interested\s*2/ })).toBeInTheDocument());
    expect(within(rail).getByRole('link', { name: /Needs review\s*1/ })).toHaveAttribute('aria-current', 'page');
    expect(within(rail).getByRole('link', { name: /Not interested\s*1/ })).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: /Snoozed\s*0/ })).toBeInTheDocument();
    expect(within(rail).getByRole('link', { name: /Sent today\s*0/ })).toBeInTheDocument();
  });

  it('switches view through the rail and keeps it in the URL', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox();
    const rail = await screen.findByRole('navigation', { name: 'Inbox views' });
    await user.click(within(rail).getByRole('link', { name: /^Interested/ }));
    expect(await screen.findByRole('button', { name: /Ada Example/ })).toBeInTheDocument();
    expect(search().get('view')).toBe('interested');
  });

  it('lists saved views and applies their filters', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole('link', { name: 'Rae — interested' }));
    expect(search().get('view')).toBe('interested');
    expect(search().get('mailbox')).toBe('mb1');
  });

  it('shows the inbox-zero empty state for an empty view', async () => {
    installInbox([]);
    renderInbox('/inbox?view=interested');
    expect(await screen.findByText('Inbox zero — nothing waiting')).toBeInTheDocument();
  });

  it('shows an error with Retry that refetches', async () => {
    installInbox(ITEMS);
    let fail = true;
    server.use(
      http.get('*/api/inbox', () => (fail ? HttpResponse.json({ success: false, error: 'boom' }, { status: 500 }) : undefined))
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    const retry = await screen.findByRole('button', { name: 'Retry' });
    fail = false;
    await user.click(retry);
    expect(await screen.findByRole('button', { name: /Ada Example/ })).toBeInTheDocument();
  });

  it('list rows show mailbox, label in words, snippet, age and presence', async () => {
    installInbox([item('d1', 'interested', { presence: [{ userId: 'u2', name: 'Sofia Delgado', mode: 'editing' }] })]);
    renderInbox('/inbox?view=interested');
    const row = await screen.findByRole('button', { name: /Ada Example/ });
    expect(within(row).getByText('rae')).toBeInTheDocument();
    expect(within(row).getByText('Interested')).toBeInTheDocument();
    expect(within(row).getByText(/thanks for getting back/i)).toBeInTheDocument();
    expect(within(row).getByText('30m')).toBeInTheDocument();
    expect(within(row).getByText('Sofia editing')).toBeInTheDocument();
    expect(row.textContent).not.toMatch(/%/);
  });

  it('opening a row puts the item in the URL and shows the reply pane', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await user.click(await screen.findByRole('button', { name: /Ada Example/ }));
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    expect(search().get('item')).toBe('d1');
    expect(within(pane).getByText('ada@example.org')).toBeInTheDocument();
    expect(within(pane).getByText('Interested')).toBeInTheDocument();
    expect(within(pane).getByText('Asks for a call next week')).toBeInTheDocument();
    expect(within(pane).getByText('love to chat').tagName).toBe('MARK');
    expect(within(pane).getByRole('textbox', { name: 'Reply' })).toHaveValue(
      "Hi Ada,\n\nThanks for getting back to me! Let's find a time.\n\nBest,\nRae"
    );
    expect(within(pane).getByText('Sending as rae@archive.com · CC no one · Lever: no change')).toBeInTheDocument();
    expect(within(pane).queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(pane.textContent).not.toMatch(/\d%/);
  });

  it('a refresh with ?item= reopens the reply even if it is not in the view', async () => {
    installInbox(ITEMS, {});
    // d9 is not in any list (e.g. snoozed); GET /drafts/d9 still serves it.
    server.use(
      http.get('*/api/drafts/d9', () => HttpResponse.json({ success: true, data: (globalThis as { __d9?: unknown }).__d9 }))
    );
    const { draftFor } = await import('./fixtures');
    (globalThis as { __d9?: unknown }).__d9 = draftFor(item('d9', 'snoozed'));
    renderInbox('/inbox?view=interested&item=d9');
    expect(await screen.findByRole('region', { name: 'Reply to Zed Snoozer' })).toBeInTheDocument();
  });

  it('legacy ?draftId= links open the item', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?draftId=d2');
    expect(await screen.findByRole('region', { name: 'Reply to Ben Sample' })).toBeInTheDocument();
    expect(search().get('item')).toBe('d2');
    expect(search().get('draftId')).toBeNull();
  });

  it('Show changes diffs the AI draft against the edited body and Revert restores it', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    const box = within(pane).getByRole('textbox', { name: 'Reply' });
    await user.clear(box);
    await user.type(box, 'Hi Ada, short and sweet.');
    await user.click(within(pane).getByRole('button', { name: 'Show changes' }));
    expect(within(pane).getByLabelText('Changes from the AI draft')).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Revert to AI draft' }));
    expect(within(pane).getByRole('textbox', { name: 'Reply' })).toHaveValue("Hi Ada,\n\nThanks for getting back to me! Let's find a time.\n\nBest,\nRae");
  });

  it('Preview shows the reply as it will read', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    await user.click(within(pane).getByRole('button', { name: 'Preview' }));
    expect(within(pane).queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    expect(within(pane).getByLabelText('Reply preview')).toHaveTextContent("Let's find a time.");
  });

  it('shows thread context with earlier messages', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    await user.click(within(pane).getByRole('button', { name: /1 earlier message/ }));
    expect(within(pane).getByText(/We are hiring a Senior Engineer/)).toBeInTheDocument();
  });
});
