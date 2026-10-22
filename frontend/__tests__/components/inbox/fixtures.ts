// Fake inbox backend for RTL tests: msw handlers over a small mutable store,
// plus a log of every request body so tests can assert what was sent.
import { http, HttpResponse, type JsonBodyType } from 'msw';
import { setupServer } from 'msw/node';
import type { EmailDraft, InboxItem, InboxView } from '../../../src/lib/api';

export const server = setupServer();

const NOW = Date.now();
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

export const MAILBOX = { id: 'mb1', emailAddress: 'rae@archive.com', displayName: 'Rae Recruiter' };

type Person = { id: string; name: string; email: string };
export const PEOPLE: Record<string, Person> = {
  d1: { id: 'c1', name: 'Ada Example', email: 'ada@example.org' },
  d2: { id: 'c2', name: 'Ben Sample', email: 'ben@example.org' },
  d3: { id: 'c3', name: 'Cy Placeholder', email: 'cy@example.org' },
  d4: { id: 'c4', name: 'Dee Fixture', email: 'dee@example.org' },
  d5: { id: 'c5', name: 'Eli Mock', email: 'eli@example.org' },
  d9: { id: 'c9', name: 'Zed Snoozer', email: 'zed@example.org' },
};

const CLASS: Record<InboxView, string> = {
  needs_review: 'NEUTRAL',
  interested: 'INTERESTED',
  not_interested: 'NOT_INTERESTED',
  snoozed: 'INTERESTED',
  sent_today: 'INTERESTED',
};

export function item(id: string, view: InboxView, extra: Partial<InboxItem> = {}): InboxItem {
  const p = PEOPLE[id] ?? { id: `c-${id}`, name: `Person ${id}`, email: `${id}@example.org` };
  return {
    kind: 'draft',
    id,
    view,
    sortAt: ago(30),
    ageMs: 30 * 60_000,
    draft: {
      id,
      threadId: `t-${id}`,
      status: view === 'sent_today' ? 'SENT' : 'PENDING',
      subject: 'Re: Senior Engineer',
      preview: `Hi ${p.name.split(' ')[0]}, thanks for getting back to me!`,
      classification: CLASS[view],
      confidence: 0.92,
      confidenceLabel: 'high',
      classificationReason: 'Asks for a call next week',
      evidenceQuote: 'love to chat',
      hasEdits: false,
      editedAt: null,
      snoozedUntil: view === 'snoozed' ? new Date(NOW + 86400_000).toISOString() : null,
      returnedFromSnoozeAt: null,
      scheduledSendAt: null,
      sentAt: view === 'sent_today' ? ago(5) : null,
      sendError: null,
      ccAddress: null,
      createdAt: ago(30),
    },
    candidate: {
      id: p.id,
      name: p.name,
      email: p.email,
      role: 'Senior Engineer',
      status: 'INTERESTED',
      leverState: 'NOT_FOUND',
      leverStage: null,
      leverPostingTitle: null,
      leverOpportunityId: null,
    },
    mailbox: MAILBOX,
    presence: [],
    ...extra,
  };
}

export function draftFor(it: InboxItem, extra: Partial<EmailDraft> = {}): EmailDraft {
  const d = it.draft!;
  const c = it.candidate!;
  const body = `Hi ${c.name.split(' ')[0]},\n\nThanks for getting back to me! Let's find a time.\n\nBest,\nRae`;
  return {
    id: d.id,
    threadId: d.threadId,
    subject: d.subject,
    bodyText: body,
    aiBodyText: body,
    classification: d.classification as EmailDraft['classification'],
    confidence: d.confidence,
    confidenceLabel: d.confidenceLabel,
    classificationReason: d.classificationReason,
    evidenceQuote: d.evidenceQuote,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.createdAt,
    ccAddress: null,
    ccEmail: null,
    presence: [],
    originalMessage: {
      id: `m-${d.id}`,
      fromAddress: c.email,
      fromName: c.name,
      subject: 'Re: Senior Engineer',
      bodyText: "Thanks! I'd love to chat next week.",
      bodyHtml: null,
      receivedAt: ago(40),
    },
    thread: {
      id: d.threadId,
      mailboxId: MAILBOX.id,
      mailbox: { id: MAILBOX.id, emailAddress: MAILBOX.emailAddress, provider: 'GMAIL' },
      externalThreadId: `x-${d.id}`,
      subject: 'Senior Engineer',
      lastMessageAt: ago(40),
      createdAt: ago(600),
      candidate: { id: c.id, name: c.name, email: c.email, status: 'INTERESTED', role: c.role },
      messages: [
        {
          id: `m-${d.id}`, threadId: d.threadId, mailboxId: MAILBOX.id, externalMessageId: 'e2',
          fromAddress: c.email, fromName: c.name, toAddresses: [MAILBOX.emailAddress], subject: 'Re: Senior Engineer',
          bodyText: "Thanks! I'd love to chat next week.", receivedAt: ago(40), headers: {}, createdAt: ago(40),
        },
        {
          id: `m0-${d.id}`, threadId: d.threadId, mailboxId: MAILBOX.id, externalMessageId: 'e1',
          fromAddress: MAILBOX.emailAddress, fromName: 'Rae', toAddresses: [c.email], subject: 'Senior Engineer',
          bodyText: 'Hi! We are hiring a Senior Engineer — interested?', receivedAt: ago(600), headers: {}, createdAt: ago(600),
        },
      ],
    },
    ...extra,
  };
}

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Install the default handlers over `items`; returns the store and call log. */
export function installInbox(
  initial: InboxItem[],
  drafts: Record<string, Partial<EmailDraft>> = {},
  opts: { pageSize?: number } = {}
) {
  const store = { items: [...initial], calls: [] as Call[] };
  const views: InboxView[] = ['needs_review', 'interested', 'not_interested', 'snoozed', 'sent_today'];
  const log = async (request: Request) => {
    let body: unknown = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    const call = { method: request.method, path: new URL(request.url).pathname, body };
    store.calls.push(call);
    return call;
  };
  const remove = (id: string) => {
    store.items = store.items.filter((i) => i.id !== id);
  };
  const ok = (data: JsonBodyType, status = 200) => HttpResponse.json({ success: true, data }, { status });
  const findDraft = (id: string) => {
    const it = [...initial].find((i) => i.id === id);
    return it ? draftFor(it, drafts[id]) : null;
  };

  server.use(
    http.get('*/api/inbox', ({ request }) => {
      const url = new URL(request.url);
      const view = (url.searchParams.get('view') ?? 'needs_review') as InboxView;
      const roles = url.searchParams.getAll('role');
      const roleOf = (i: InboxItem) => i.candidate?.role?.trim() || null;
      const roleOk = (i: InboxItem) =>
        roles.length === 0 || roles.some((r) => (r === '__none__' ? roleOf(i) === null : r === roleOf(i)));
      const inView = store.items.filter((i) => i.view === view);
      const counts = Object.fromEntries(
        views.map((v) => [v, store.items.filter((i) => i.view === v && (v !== view || roleOk(i))).length])
      );
      const roleCounts = [...new Set(inView.map(roleOf))].map((role) => ({
        role,
        count: inView.filter((i) => roleOf(i) === role).length,
      }));
      let items = inView.filter(roleOk);
      if (url.searchParams.get('order') === 'oldest') items = [...items].reverse();
      // Offset cursor: enough to exercise paging (the real one is keyset).
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const size = opts.pageSize ?? items.length;
      const page = items.slice(start, start + size);
      const nextCursor = start + size < items.length ? String(start + size) : null;
      return ok({ items: page, counts, roleCounts, nextCursor });
    }),
    http.get('*/api/drafts/cc-options', () =>
      ok([
        { email: null, name: 'No CC', firstName: null },
        { email: 'sofia@archive.com', name: 'Sofia Delgado', firstName: 'Sofia' },
      ])
    ),
    http.get('*/api/drafts/:id', ({ params }) => {
      const d = findDraft(String(params.id));
      return d ? ok(d as unknown as JsonBodyType) : HttpResponse.json({ success: false, error: 'Draft not found' }, { status: 404 });
    }),
    http.patch('*/api/drafts/:id', async ({ request, params }) => {
      const call = await log(request);
      const d = findDraft(String(params.id))!;
      return ok({ ...d, ...(call.body as object) } as unknown as JsonBodyType);
    }),
    http.post('*/api/drafts/batch-send', async ({ request }) => {
      const call = await log(request);
      const ids = (call.body as { draftIds: string[] }).draftIds;
      ids.forEach(remove);
      return ok({ scheduled: ids, skipped: [], scheduledSendAt: new Date(Date.now() + 10_000).toISOString(), undoSeconds: 10 }, 202);
    }),
    http.post('*/api/drafts/:id/send', async ({ request, params }) => {
      await log(request);
      remove(String(params.id));
      return ok({ id: params.id as string, status: 'SCHEDULED', scheduledSendAt: new Date(Date.now() + 10_000).toISOString(), undoSeconds: 10 }, 202);
    }),
    http.post('*/api/drafts/:id/undo-send', async ({ request, params }) => {
      await log(request);
      const it = initial.find((i) => i.id === params.id);
      if (it && !store.items.some((i) => i.id === it.id)) store.items.push(it);
      return ok({ id: params.id as string, status: 'PENDING' });
    }),
    http.post('*/api/drafts/:id/dismiss', async ({ request, params }) => {
      await log(request);
      remove(String(params.id));
      return ok({ id: params.id as string, status: 'DISCARDED' });
    }),
    http.post('*/api/drafts/:id/snooze', async ({ request, params }) => {
      const call = await log(request);
      remove(String(params.id));
      return ok({ id: params.id as string, snoozedUntil: (call.body as { until: string }).until });
    }),
    http.post('*/api/drafts/:id/unsnooze', async ({ request, params }) => {
      await log(request);
      return ok({ id: params.id as string, snoozedUntil: null });
    }),
    http.post('*/api/drafts/:id/presence', async ({ request }) => {
      await log(request);
      return ok({ presence: [] });
    }),
    http.delete('*/api/drafts/:id/presence', async ({ request }) => {
      await log(request);
      return HttpResponse.json({ success: true });
    }),
    http.post('*/api/drafts/:id/dictate', async ({ request, params }) => {
      const call = await log(request);
      const d = findDraft(String(params.id))!;
      const notes = (call.body as { notes: string }).notes;
      return ok({ ...d, bodyText: `Rewritten (${notes})`, editedAt: new Date().toISOString() } as unknown as JsonBodyType);
    }),
    http.post('*/api/drafts/:id/regenerate', async ({ request, params }) => {
      await log(request);
      const d = findDraft(String(params.id))!;
      return ok({ ...d, aiBodyText: 'Fresh AI text', keptEdits: true } as unknown as JsonBodyType);
    }),
    http.get('*/api/mailboxes', () => ok([{ ...MAILBOX, provider: 'GMAIL', isActive: true, createdAt: ago(9999), updatedAt: ago(1) }])),
    http.get('*/api/views', () =>
      ok([{ id: 'v1', userId: null, name: 'Rae — interested', scope: 'inbox', filters: { view: 'interested', mailboxId: 'mb1' }, shared: true, createdAt: ago(99), updatedAt: ago(9) }])
    ),
    http.get('*/api/lever/me', () => ok({ configured: false }))
  );
  return store;
}
