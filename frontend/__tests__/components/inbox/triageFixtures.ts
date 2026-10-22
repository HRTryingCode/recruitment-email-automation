// Shared by TriageFlow and InboxPass3: an Inbox with draftless Needs-review candidates.
import { http, HttpResponse, delay, type JsonBodyType } from 'msw';
import type { EmailDraft, InboxItem } from '../../../src/lib/api';
import { MAILBOX, draftFor, installInbox, item, server } from './fixtures';

export function candidateItem(id: string, name: string, mailbox = MAILBOX): InboxItem {
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

export interface TriageOpts {
  mailbox?: typeof MAILBOX;
  ccEmail?: string;
  /** Fail the first N draft POSTs with a 502. */
  failFirst?: number;
  /** Hold the POST until this promise resolves. */
  gate?: Promise<void>;
}

/** Inbox with two draftless candidates (c5 Eli, c6 Fay) and an existing Interested draft. */
export function installTriage(opts: TriageOpts = {}) {
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
