// H8: "Reply as Interested / Not interested / Ignore" on a draftless
// Needs-review candidate shows where the result went.
import { http, HttpResponse, delay, type JsonBodyType } from 'msw';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EmailDraft, InboxItem } from '../../../src/lib/api';
import { MAILBOX, draftFor, installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
});
afterAll(() => server.close());

function candidateItem(id: string, name: string, mailbox = MAILBOX): InboxItem {
  return {
    ...item(id, 'needs_review'),
    kind: 'candidate',
    id,
    draft: null,
    candidate: {
      id, name, email: `${name.split(' ')[0].toLowerCase()}@example.org`, role: 'Senior Engineer', status: 'NEEDS_REVIEW',
      leverState: 'NOT_FOUND', leverStage: null, leverPostingTitle: null, leverOpportunityId: null,
    },
    mailbox,
  };
}

interface TriageOpts {
  mailbox?: typeof MAILBOX;
  ccEmail?: string;
  /** Fail the first N draft POSTs with a 502. */
  failFirst?: number;
  /** Hold the POST until this promise resolves. */
  gate?: Promise<void>;
}

/** Inbox with two draftless candidates (c5 Eli, c6 Fay) and an existing Interested draft. */
function installTriage(opts: TriageOpts = {}) {
  const mailbox = opts.mailbox ?? MAILBOX;
  const eli = candidateItem('c5', 'Eli Mock', mailbox);
  const fay = candidateItem('c6', 'Fay Stub', mailbox);
  const store = installInbox([eli, fay, item('d1', 'interested')]);
  const posts: Array<{ threadId: string; body: unknown }> = [];
  const unignored: string[] = [];
  const ignored: string[] = [];
  let fails = opts.failFirst ?? 0;
  const drafts: Record<string, EmailDraft> = {};

  server.use(
    http.get('*/api/candidates/:id', ({ params }) => {
      const id = String(params.id);
      const name = id === 'c5' ? 'Eli Mock' : 'Fay Stub';
      return HttpResponse.json({
        success: true,
        data: {
          id, name, email: `${name.split(' ')[0].toLowerCase()}@example.org`, status: 'NEEDS_REVIEW',
          threads: [
            {
              id: `t-${id}`,
              drafts: [],
              messages: [
                { id: `m-${id}`, fromAddress: 'x@example.org', fromName: name, bodyText: 'Maybe? Tell me more.', receivedAt: new Date().toISOString() },
              ],
            },
          ],
        },
      });
    }),
    http.post('*/api/emails/threads/:id/draft', async ({ request, params }) => {
      const body = (await request.json()) as { classification: 'INTERESTED' | 'NOT_INTERESTED' };
      posts.push({ threadId: String(params.id), body });
      if (opts.gate) await opts.gate;
      else await delay(30);
      if (fails > 0) {
        fails--;
        return HttpResponse.json({ success: false, error: 'The model is busy' }, { status: 502 });
      }
      const candidateId = String(params.id).replace('t-', '');
      const view = body.classification === 'INTERESTED' ? 'interested' : 'not_interested';
      const id = `dnew-${candidateId}`;
      const it = item(id, view, { candidate: { ...(candidateId === 'c5' ? eli : fay).candidate! }, mailbox });
      const d = draftFor(it, {
        confidence: 1,
        ccEmail: opts.ccEmail ?? '',
        ccAddress: opts.ccEmail ?? null,
        thread: { ...draftFor(it).thread!, mailbox: { id: mailbox.id, emailAddress: mailbox.emailAddress, provider: 'GMAIL' } },
      });
      drafts[id] = d;
      store.items = store.items.filter((i) => i.id !== candidateId).concat(it);
      const { thread: _t, originalMessage: _o, ...raw } = d;
      return HttpResponse.json({ success: true, data: raw as unknown as JsonBodyType }, { status: 201 });
    }),
    http.get('*/api/drafts/:id', ({ params }) => {
      const d = drafts[String(params.id)];
      return d ? HttpResponse.json({ success: true, data: d as unknown as JsonBodyType }) : undefined;
    }),
    http.post('*/api/drafts/:id/presence', () => HttpResponse.json({ success: true, data: { presence: [] } })),
    http.post('*/api/candidates/:id/ignore', ({ params }) => {
      ignored.push(String(params.id));
      store.items = store.items.filter((i) => i.id !== params.id);
      return HttpResponse.json({ success: true, data: { id: params.id } });
    }),
    http.post('*/api/candidates/:id/unignore', ({ params }) => {
      unignored.push(String(params.id));
      if (params.id === 'c5') store.items.unshift(eli);
      return HttpResponse.json({ success: true, data: { id: params.id } });
    })
  );
  return { store, posts, ignored, unignored };
}

const rail = () => screen.getByRole('navigation', { name: 'Inbox views' });

describe('Triage draft flow', () => {
  it('reply as interested: progress → in-place draft + banner → URL → Go to Interested → highlight', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const { posts } = installTriage({ gate });
    const user = userEvent.setup();
    renderInbox('/inbox?view=needs_review&item=candidate:c5');

    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Interested/ }));

    // 1. Progress: the clicked button says what's happening, the draft area is a skeleton.
    expect(await within(pane).findByRole('button', { name: /Writing reply…/ })).toBeDisabled();
    expect(within(pane).getByRole('button', { name: /Reply as Not interested/ })).toBeDisabled();
    expect(within(pane).getByRole('button', { name: /Ignore candidate/ })).toBeDisabled();
    expect(within(pane).getByRole('status', { name: 'Writing your reply…' })).toBeInTheDocument();
    expect(posts).toEqual([{ threadId: 't-c5', body: { classification: 'INTERESTED' } }]);
    await act(async () => open());

    // 2. In place: the draft's reply pane with a success banner.
    const banner = await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
    expect(within(banner).getByText('Reply from rae@archive.com')).toBeInTheDocument();
    const draftPane = screen.getByRole('region', { name: 'Reply to Eli Mock' });
    expect(await within(draftPane).findByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
    expect(search().get('view')).toBe('interested');
    expect(search().get('item')).toBe('dnew-c5');

    // 3. Rail counts move; the list stays on Needs review for context.
    await waitFor(() => expect(within(rail()).getByRole('link', { name: /Needs review\s*1/ })).toBeInTheDocument());
    const interestedLink = within(rail()).getByRole('link', { name: /^Interested\s*2/ });
    expect(within(interestedLink).getByText('2')).toHaveAttribute('data-changed', 'true');
    expect(screen.getByRole('list', { name: 'Needs review replies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Needs review' }).nextElementSibling).toHaveTextContent('1');

    // 4. Toast as a secondary signal.
    expect(await screen.findByText('Draft created for Eli Mock in Interested')).toBeInTheDocument();

    // Go to Interested: list switches, the new row is highlighted and selected.
    await user.click(within(banner).getByRole('button', { name: 'Go to Interested' }));
    const list = await screen.findByRole('list', { name: 'Interested replies' });
    const row = await within(list).findByRole('button', { name: /Eli Mock/ });
    expect(row).toHaveAttribute('data-highlighted', 'true');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(within(rail()).getByRole('link', { name: /^Interested/ })).toHaveAttribute('aria-current', 'page');
    expect(search().get('item')).toBe('dnew-c5');
  });

  it('hand-off drafts name the CC and the mailbox in the banner', async () => {
    installTriage({ mailbox: { id: 'mb2', emailAddress: 'paul.b@archive.com', displayName: 'Paul B' }, ccEmail: 'sofia@archive.com' });
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Interested/ }));
    const banner = await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
    expect(await within(banner).findByText('Hand-off to Sofia from paul.b@')).toBeInTheDocument();
  });

  it('Review & send focuses the editor; the banner can be dismissed', async () => {
    installTriage();
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Interested/ }));
    const banner = await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
    const editor = await screen.findByRole('textbox', { name: 'Reply' });
    await user.click(within(banner).getByRole('button', { name: 'Review & send' }));
    expect(editor).toHaveFocus();
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert', { name: /Reply drafted/ })).not.toBeInTheDocument();
  });

  it('reply as not interested moves to Not interested', async () => {
    const { posts } = installTriage();
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Not interested/ }));
    const banner = await screen.findByRole('alert', { name: 'Reply drafted · moved to Not interested' });
    expect(posts[0].body).toEqual({ classification: 'NOT_INTERESTED' });
    expect(search().get('view')).toBe('not_interested');
    await user.click(within(banner).getByRole('button', { name: 'Go to Not interested' }));
    const list = await screen.findByRole('list', { name: 'Not interested replies' });
    expect(await within(list).findByRole('button', { name: /Eli Mock/ })).toHaveAttribute('data-highlighted', 'true');
  });

  it('navigating away while writing only toasts; Open goes to the draft', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    installTriage({ gate });
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Interested/ }));
    await user.click(screen.getByRole('button', { name: /Fay Stub/ }));
    expect(await screen.findByRole('region', { name: 'Reply to Fay Stub' })).toBeInTheDocument();
    await act(async () => open());

    const toast = await screen.findByText('Draft created for Eli Mock in Interested');
    // Still on Fay, no banner.
    expect(search().get('item')).toBe('candidate:c6');
    expect(screen.queryByRole('alert', { name: /Reply drafted/ })).not.toBeInTheDocument();
    const toastEl = toast.closest('[data-sonner-toast]') as HTMLElement;
    await user.click(within(toastEl).getByRole('button', { name: 'Open' }));
    await waitFor(() => expect(search().get('item')).toBe('dnew-c5'));
    expect(search().get('view')).toBe('interested');
    const list = await screen.findByRole('list', { name: 'Interested replies' });
    expect(await within(list).findByRole('button', { name: /Eli Mock/ })).toHaveAttribute('data-highlighted', 'true');
  });

  it('a failed draft shows an inline Alert with Retry and keeps the selection', async () => {
    const { posts } = installTriage({ failFirst: 1 });
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.click(within(pane).getByRole('button', { name: /Reply as Interested/ }));

    const alert = await within(pane).findByRole('alert');
    expect(within(alert).getByText("Couldn't write the reply")).toBeInTheDocument();
    expect(within(alert).getByText('The model is busy')).toBeInTheDocument();
    expect(search().get('item')).toBe('candidate:c5');
    expect(within(pane).getByText('Maybe? Tell me more.')).toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' })).toBeInTheDocument();
    expect(posts.map((p) => p.body)).toEqual([{ classification: 'INTERESTED' }, { classification: 'INTERESTED' }]);
  });

  it('a double click posts once', async () => {
    const { posts } = installTriage();
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await within(pane).findByText('Maybe? Tell me more.');
    await user.dblClick(within(pane).getByRole('button', { name: /Reply as Interested/ }));
    await screen.findByRole('alert', { name: 'Reply drafted · moved to Interested' });
    expect(posts).toHaveLength(1);
  });

  it('ignore toasts with Undo, advances to the next item, and Undo calls unignore', async () => {
    const { ignored, unignored } = installTriage();
    const user = userEvent.setup();
    renderInbox('/inbox?item=candidate:c5');
    const pane = await screen.findByRole('region', { name: 'Reply to Eli Mock' });
    await user.click(within(pane).getByRole('button', { name: /Ignore candidate/ }));

    expect(await screen.findByRole('region', { name: 'Reply to Fay Stub' })).toBeInTheDocument();
    expect(search().get('item')).toBe('candidate:c6');
    expect(ignored).toEqual(['c5']);
    const toast = (await screen.findByText('Ignored Eli Mock')).closest('[data-sonner-toast]') as HTMLElement;
    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(unignored).toEqual(['c5']));
    expect(await screen.findByRole('button', { name: /Eli Mock/ })).toBeInTheDocument();
  });
});
