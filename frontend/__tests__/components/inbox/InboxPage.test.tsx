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
    expect(search().get('mailboxId')).toBe('mb1');
  });

  it('shows the inbox-zero empty state for an empty view', async () => {
    installInbox([]);
    renderInbox('/inbox?view=interested');
    expect(await screen.findByText('Inbox zero — nothing waiting')).toBeInTheDocument();
  });

  it('explains what lands in each empty view', async () => {
    installInbox([]);
    renderInbox('/inbox?view=snoozed');
    expect(await screen.findByText('Nothing snoozed')).toBeInTheDocument();
    expect(screen.getByText('Press S on a reply to bring it back later.')).toBeInTheDocument();
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

  it('rows and the pane flag failed sends, returned snoozes, edits and expiry', async () => {
    const base = item('d1', 'needs_review');
    installInbox(
      [
        item('d1', 'needs_review', {
          draft: {
            ...base.draft!,
            status: 'FAILED',
            sendError: 'Gmail rejected the message',
            returnedFromSnoozeAt: new Date().toISOString(),
            hasEdits: true,
            editedByName: 'Ana Recruiter',
            expiresAt: new Date(Date.now() + 2 * 86_400_000 + 60_000).toISOString(),
          },
        }),
      ],
      { d1: { status: 'FAILED', sendError: 'Gmail rejected the message', bodyText: 'Edited body', editedByName: 'Ana Recruiter', hasEdits: true } }
    );
    renderInbox('/inbox?view=needs_review');
    const row = await screen.findByRole('button', { name: /Ada Example/ });
    expect(within(row).getByText('Send failed')).toBeInTheDocument();
    expect(within(row).getByText('Back from snooze')).toBeInTheDocument();
    expect(within(row).getByText('Edited by Ana')).toBeInTheDocument();
    expect(within(row).getByText('Expires in 2d')).toBeInTheDocument();
    await userEvent.setup().click(row);
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    expect(within(pane).getByText('Edited by Ana')).toBeInTheDocument();
    expect(within(pane).getByText('Send failed')).toBeInTheDocument();
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
    expect(within(pane).getByTestId('role-chip')).toHaveTextContent('Senior Engineer');
    expect(within(pane).getByText('Interested')).toBeInTheDocument();
    expect(within(pane).getByText('Asks for a call next week')).toBeInTheDocument();
    expect(within(pane).getByText('love to chat').tagName).toBe('MARK');
    expect(within(pane).getByRole('textbox', { name: 'Reply' })).toHaveValue(
      "Hi Ada,\n\nThanks for getting back to me! Let's find a time.\n\nBest,\nRae"
    );
    expect(within(pane).getByText('Sending as rae@archive.com · CC no one')).toBeInTheDocument();
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

  it('legacy ?candidateId= opens that candidate\'s reply when it is in the view', async () => {
    installInbox(ITEMS);
    renderInbox('/inbox?view=interested&candidateId=c2');
    expect(await screen.findByRole('region', { name: 'Reply to Ben Sample' })).toBeInTheDocument();
    expect(search().get('item')).toBe('d2');
    expect(search().get('candidateId')).toBeNull();
  });

  it('legacy ?candidateId= falls back to the candidate\'s newest live draft', async () => {
    installInbox(ITEMS);
    server.use(
      http.get('*/api/candidates/c9', () =>
        HttpResponse.json({
          success: true,
          data: {
            id: 'c9',
            name: 'Zed Snoozer',
            threads: [
              {
                id: 't9',
                drafts: [
                  { id: 'old', status: 'SENT', createdAt: '2026-10-01T00:00:00Z' },
                  { id: 'd9', status: 'PENDING', createdAt: '2026-10-20T00:00:00Z' },
                ],
              },
            ],
          },
        })
      ),
      http.get('*/api/drafts/d9', async () => {
        const { draftFor } = await import('./fixtures');
        return HttpResponse.json({ success: true, data: draftFor(item('d9', 'snoozed')) });
      })
    );
    renderInbox('/inbox?view=interested&candidateId=c9');
    expect(await screen.findByRole('region', { name: 'Reply to Zed Snoozer' })).toBeInTheDocument();
    expect(search().get('item')).toBe('d9');
  });

  it('shows the Lever section and one label chip in the reply header', async () => {
    installInbox(ITEMS, {
      d1: {
        thread: {
          ...(await import('./fixtures')).draftFor(item('d1', 'interested')).thread!,
          candidate: {
            id: 'c1', name: 'Ada Example', email: 'ada@example.org', status: 'NEUTRAL', role: 'Senior Engineer',
            leverState: 'ACTIVE', leverOpportunityId: 'opp1', leverPostingTitle: 'Senior Engineer', leverStage: 'Phone Screen',
            leverCheckedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
          } as never,
        },
      },
    });
    renderInbox('/inbox?view=interested&item=d1');
    const pane = await screen.findByRole('region', { name: 'Reply to Ada Example' });
    const header = within(pane).getByRole('banner');
    const lever = within(header).getByRole('group', { name: 'Lever' });
    expect(within(lever).getByText('In Lever')).toBeInTheDocument();
    expect(within(lever).getByText('Senior Engineer · Phone Screen')).toBeInTheDocument();
    expect(within(lever).getByText('Checked 10m ago')).toBeInTheDocument();
    expect(within(lever).getByRole('link', { name: /Open in Lever/ })).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp1');
    expect(within(header).getByText('ada@example.org')).toBeInTheDocument();
    // Role shows once, as the shared RoleChip, not appended to the email line.
    expect(within(header).getByTestId('role-chip')).toHaveTextContent('Senior Engineer');
    // One label chip in words — no candidate-status badge ("Neutral"), no %.
    expect(within(header).getByText('Interested')).toBeInTheDocument();
    expect(within(header).queryByText(/neutral/i)).not.toBeInTheDocument();
    expect(header.textContent).not.toMatch(/\d%/);
  });

  it('prefetches the Add to Lever dialog data when an item is selected', async () => {
    installInbox(ITEMS);
    const hits: string[] = [];
    server.use(
      http.get('*/api/lever/me', () =>
        HttpResponse.json({ success: true, data: { configured: true, createEnabled: true, leverUser: { id: 'lu1', name: 'Rae' }, appEmail: 'rae@archive.com' } })
      ),
      http.get('*/api/candidates/:id/lever/prefill', ({ params }) => {
        hits.push(`prefill:${String(params.id)}`);
        return HttpResponse.json({ success: true, data: {} });
      }),
      http.get('*/api/candidates/:id/lever/prefill/gem', () => HttpResponse.json({ success: true, data: { status: 'NOT_CONNECTED' } })),
      http.get('*/api/lever/postings', () => HttpResponse.json({ success: true, data: [] }))
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await user.click(await screen.findByRole('button', { name: /Ben Sample/ }));
    await waitFor(() => expect(hits).toContain('prefill:c2'));
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
