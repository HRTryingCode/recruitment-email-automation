// U2b: Inbox UX pass 3 — cursor ring, candidate links + ⌘K, triage keys on
// candidate rows, Hide candidate, roomier reply header, one shortcuts dialog.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { location, renderInbox, search } from './renderInbox';
import { installTriage } from './triageFixtures';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

const key = (k: string, extra: Record<string, unknown> = {}) => fireEvent.keyDown(document.body, { key: k, ...extra });

describe('page heading', () => {
  it('has a screen-reader h1', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    expect(await screen.findByRole('heading', { level: 1, name: 'Inbox' })).toHaveClass('sr-only');
  });
});

describe('keyboard cursor', () => {
  it('uses a solid ring, not a faded one', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    const row = await screen.findByRole('button', { name: /Ada Example/ });
    expect(row).toHaveAttribute('data-focused', 'true');
    expect(row.className).toContain('data-[focused=true]:ring-ring ');
    expect(row.className).not.toContain('ring-ring/40');
  });
});

describe('candidate link', () => {
  it('reply pane name links to the candidate on Candidates', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    const link = await within(pane).findByRole('link', { name: 'Ada Example' });
    expect(link.getAttribute('href')).toMatch(/^\/candidates\?.*candidate=c1/);
  });

  it('candidate pane name links to the candidate', async () => {
    installTriage();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    expect(within(pane).getByRole('link', { name: 'Eli Mock' }).getAttribute('href')).toMatch(/candidate=c5/);
  });

  it('⌘K offers "Open candidate" for the open reply', async () => {
    installInbox([item('d1', 'interested')]);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await screen.findByRole('region', { name: 'Reply to Ada Example' });
    key('k', { metaKey: true });
    const palette = await screen.findByRole('dialog');
    await user.click(within(palette).getByRole('option', { name: /Open candidate · Ada Example/ }));
    await waitFor(() => expect(location.current).toMatch(/^\/candidates\?.*candidate=c1/));
  });

  it('⌘K has no "Open candidate" with nothing open', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    key('k', { metaKey: true });
    const palette = await screen.findByRole('dialog');
    expect(within(palette).queryByRole('option', { name: /Open candidate/ })).not.toBeInTheDocument();
  });
});

describe('triage keys on candidate rows', () => {
  async function openEli() {
    const t = installTriage();
    renderInbox('/inbox?view=needs_review&item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    return t;
  }

  it('I replies as Interested', async () => {
    const { posts } = await openEli();
    key('i');
    await waitFor(() => expect(posts).toEqual([{ threadId: 't-c5', body: { classification: 'INTERESTED' } }]));
    await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
  });

  it('N replies as Not interested', async () => {
    const { posts } = await openEli();
    key('n');
    await waitFor(() => expect(posts).toEqual([{ threadId: 't-c5', body: { classification: 'NOT_INTERESTED' } }]));
  });

  it('I while a reply is being written does not write a second one', async () => {
    const { posts } = await openEli();
    key('i');
    key('n');
    await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
    expect(posts).toHaveLength(1);
  });

  it('D hides the candidate with Undo', async () => {
    const { ignored } = await openEli();
    key('d');
    expect(await screen.findByRole('region', { name: 'Reply to Fay Stub' })).toBeInTheDocument();
    expect(ignored).toEqual(['c5']);
    expect(await screen.findByText('Hid Eli Mock')).toBeInTheDocument();
    expect(search().get('item')).toBe('candidate:c6');
  });

  it('I and N do nothing on a draft row', async () => {
    const store = installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested&item=d1');
    await screen.findByRole('textbox', { name: 'Reply' });
    key('i');
    key('n');
    await new Promise((r) => setTimeout(r, 30));
    expect(store.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/draft'))).toHaveLength(0);
  });
});

describe('Hide candidate', () => {
  it('is named Hide and explains itself', async () => {
    installTriage();
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    const btn = within(pane).getByRole('button', { name: /Hide candidate/ });
    expect(within(pane).queryByRole('button', { name: /Ignore candidate/ })).not.toBeInTheDocument();
    await user.hover(btn);
    expect(
      (await screen.findAllByText('Hides them from Inbox and Candidates. You can undo or restore later.')).length
    ).toBeGreaterThan(0);
  });
});

describe('reply header', () => {
  it('keeps the Why line out of the fixed header (it scrolls with the body)', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    const why = await within(pane).findByText('Asks for a call next week');
    expect(why.closest('header')).toBeNull();
    expect(why.closest('[data-slot=reply-body]')).not.toBeNull();
  });
});

describe('one shortcuts dialog', () => {
  it('? on the Inbox opens the shared dialog with Global, Inbox and Candidates sections', async () => {
    installInbox([item('d1', 'interested')]);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    key('?', { shiftKey: true });
    const dialogs = await screen.findAllByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialogs).toHaveLength(1);
    const help = dialogs[0];
    for (const name of ['Global', 'Inbox', 'Candidates']) {
      expect(within(help).getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(within(help).getByText(/Reply as Interested/)).toBeInTheDocument();
    expect(within(help).getByText(/Hide candidate/)).toBeInTheDocument();
    expect(within(help).getByText('Select / deselect')).toBeInTheDocument();
  });
});

describe('status vocabulary (U2a)', () => {
  it('a draftless candidate reads "Needs review" in the row and the pane, never "Unsure"', async () => {
    installTriage();
    renderInbox('/inbox?view=needs_review&item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    expect(within(pane).getByText('Needs review')).toHaveAttribute('data-tone', 'warning');
    expect(within(pane).queryByText('Unsure')).not.toBeInTheDocument();
    const row = within(screen.getByRole('list', { name: 'Needs review replies' })).getByRole('button', { name: /Fay Stub/ });
    expect(within(row).getByText('Needs review')).toBeInTheDocument();
    expect(within(row).queryByText('Unsure')).not.toBeInTheDocument();
  });
});
