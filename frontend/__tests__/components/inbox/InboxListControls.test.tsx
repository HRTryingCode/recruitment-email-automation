// Inbox list controls: sort, role filter, group by role — all in the URL.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { InboxItem } from '../../../src/lib/api';
import { installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function withRole(id: string, role: string | null): InboxItem {
  const base = item(id, 'interested');
  return { ...base, candidate: { ...base.candidate!, role } };
}

// Store order = newest first. Designer ×2, Engineer ×1, unknown ×1.
const ITEMS = [
  withRole('d1', 'Designer'),
  withRole('d2', 'Engineer'),
  withRole('d3', 'Designer'),
  withRole('d4', null),
];

function rowNames(): string[] {
  const list = screen.getByRole('list', { name: /Interested replies/ });
  return within(list)
    .getAllByRole('button')
    .map((b) => b.querySelector('.font-medium')?.textContent ?? '');
}

describe('Inbox list controls', () => {
  it('sort switches to oldest waiting first and persists in the URL', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    expect(rowNames()).toEqual(['Ada Example', 'Ben Sample', 'Cy Placeholder', 'Dee Fixture']);
    await user.click(screen.getByRole('combobox', { name: 'Sort order' }));
    await user.click(await screen.findByRole('option', { name: 'Oldest waiting first' }));
    await waitFor(() => expect(rowNames()).toEqual(['Dee Fixture', 'Cy Placeholder', 'Ben Sample', 'Ada Example']));
    expect(search().get('sort')).toBe('oldest');
  });

  it('restores sort, role filter and grouping from the URL on load', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&sort=oldest&role=Designer&group=role');
    await screen.findByRole('button', { name: /Ada Example/ });
    expect(rowNames()).toEqual(['Cy Placeholder', 'Ada Example']);
    expect(screen.getByRole('combobox', { name: 'Sort order' })).toHaveTextContent('Oldest waiting first');
    expect(screen.getByRole('button', { name: /Filter by role/ })).toHaveTextContent('Designer');
    expect(screen.getByRole('button', { name: 'Group by role' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('role filter is a multi-select with counts, including Role unknown', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    await user.click(screen.getByRole('button', { name: /Filter by role/ }));
    const designer = await screen.findByRole('option', { name: /Designer\s*2/ });
    expect(screen.getByRole('option', { name: /Engineer\s*1/ })).toBeInTheDocument();
    await user.click(designer);
    await user.click(screen.getByRole('option', { name: /Role unknown\s*1/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Ada Example', 'Cy Placeholder', 'Dee Fixture']));
    expect(search().getAll('role')).toEqual(['Designer', '__none__']);
    // Toggle Designer back off.
    await user.click(screen.getByRole('option', { name: /Designer\s*2/ }));
    await waitFor(() => expect(rowNames()).toEqual(['Dee Fixture']));
    await user.click(screen.getByRole('option', { name: 'All roles' }));
    await waitFor(() => expect(search().getAll('role')).toEqual([]));
  });

  it('shows "No replies for this role" when the filter matches nothing', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&role=Nobody');
    expect(await screen.findByText('No replies for this role')).toBeInTheDocument();
  });

  it('group by role renders sections by count desc with Role unknown last, keeping the sort', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    await user.click(screen.getByRole('button', { name: 'Group by role' }));
    await waitFor(() => expect(search().get('group')).toBe('role'));
    const headers = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headers).toEqual(['Designer2', 'Engineer1', 'Role unknown1']);
    expect(rowNames()).toEqual(['Ada Example', 'Cy Placeholder', 'Ben Sample', 'Dee Fixture']);
  });

  it('↓ moves through items across groups in visual order', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&group=role');
    await screen.findByRole('button', { name: /Ada Example/ });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Cy Placeholder/ })).toHaveAttribute('data-focused', 'true')
    );
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Ben Sample/ })).toHaveAttribute('data-focused', 'true'));
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(() => expect(search().get('item')).toBe('d2'));
  });

  it('changing view keeps sort and grouping but clears the role filter', async () => {
    installInbox(ITEMS);
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested&sort=oldest&group=role&role=Designer');
    const rail = await screen.findByRole('navigation', { name: 'Inbox views' });
    await user.click(within(rail).getByRole('link', { name: /^Needs review/ }));
    await waitFor(() => expect(search().get('view')).toBe('needs_review'));
    expect(search().get('sort')).toBe('oldest');
    expect(search().get('group')).toBe('role');
    expect(search().getAll('role')).toEqual([]);
  });
});
