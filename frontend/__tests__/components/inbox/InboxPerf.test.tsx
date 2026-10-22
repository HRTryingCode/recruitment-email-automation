// U1b item 16: typing in the reply re-renders the editor only — not the page,
// the rail or the list rows.
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox } from './renderInbox';

const renders = vi.hoisted(() => ({ page: 0, rows: 0 }));

// One call per InboxPage render (the page calls this hook once).
vi.mock('../../../src/hooks/useNewReplyAlerts', async (orig) => {
  const actual = await orig<typeof import('../../../src/hooks/useNewReplyAlerts')>();
  return {
    ...actual,
    useNewReplyAlerts: (...args: Parameters<typeof actual.useNewReplyAlerts>) => {
      renders.page++;
      return actual.useNewReplyAlerts(...args);
    },
  };
});
// One call per list-row render.
vi.mock('../../../src/lib/utils', async (orig) => {
  const actual = await orig<typeof import('../../../src/lib/utils')>();
  return {
    ...actual,
    formatAge: (...args: Parameters<typeof actual.formatAge>) => {
      renders.rows++;
      return actual.formatAge(...args);
    },
  };
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

describe('editor isolation', () => {
  it('typing in the reply does not re-render the page or the rows', async () => {
    installInbox([item('d1', 'interested'), item('d2', 'interested'), item('d3', 'interested')]);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    const box = within(pane).getByRole('textbox', { name: 'Reply' });
    await user.click(box);
    await user.type(box, 'x');
    const before = { ...renders };
    await user.type(box, 'hello');
    expect(renders.page - before.page).toBe(0);
    expect(renders.rows - before.rows).toBe(0);
  });
});
