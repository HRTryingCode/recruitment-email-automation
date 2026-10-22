// U1b item 17: after each action a polite live region says what happened and
// what opened next; opening a reply moves focus to its heading.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

const ITEMS = [item('d1', 'interested'), item('d2', 'interested')];
const pane = (name: string) => screen.findByRole('region', { name: `Reply to ${name}` });
const live = () => screen.getByTestId('inbox-live');

describe('inbox announcements', () => {
  it('the live region is polite', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live()).toHaveAttribute('role', 'status');
  });

  it('announces the send and the next reply', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await pane('Ada Example')).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Sent to Ada Example. Opened Ben Sample.'));
  });

  it('announces a dismiss', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await pane('Ada Example')).getByRole('button', { name: /Dismiss/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Spam' }));
    await waitFor(() => expect(live()).toHaveTextContent('Dismissed Ada Example. Opened Ben Sample.'));
  });

  it('announces a snooze', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await pane('Ada Example')).getByRole('button', { name: /Snooze/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Tomorrow/ }));
    await waitFor(() => expect(live()).toHaveTextContent('Snoozed Ada Example. Opened Ben Sample.'));
  });

  it('says nothing opened after the last reply', async () => {
    installInbox([ITEMS[0]]);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    await user.click(within(await pane('Ada Example')).getByRole('button', { name: /^Send/ }));
    await waitFor(() => expect(live()).toHaveTextContent(/^Sent to Ada Example\.$/));
  });
});

describe('focus on open', () => {
  it('opening a reply focuses its heading', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await user.click(await screen.findByRole('button', { name: /Ada Example/ }));
    const p = await pane('Ada Example');
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('heading', { name: 'Ada Example' })));
  });

  it('moving to the next reply focuses the new heading', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    await pane('Ada Example');
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    const p = await pane('Ben Sample');
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('heading', { name: 'Ben Sample' })));
  });

  it('does not steal focus from the editor (E)', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&item=d1');
    const p = await pane('Ada Example');
    fireEvent.keyDown(document.body, { key: 'e' });
    await waitFor(() => expect(document.activeElement).toBe(within(p).getByRole('textbox', { name: 'Reply' })));
  });
});
