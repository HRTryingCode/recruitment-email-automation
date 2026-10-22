// U1b screenshots: built SPA via `vite preview`, /api mocked with page.route.
import { createRequire } from 'node:module';
const WT = process.argv[2];
const OUT = process.argv[3];
const require = createRequire(`${WT}/package.json`);
const { chromium } = require('playwright');

const NOW = Date.now();
const ago = (m) => new Date(NOW - m * 60_000).toISOString();
const mailbox = { id: 'mb1', emailAddress: 'rae@archive.com', displayName: 'Rae Recruiter' };
const people = [
  ['d1', 'Ada Example', 'Senior Engineer', { status: 'FAILED', sendError: 'Gmail rejected the message (mailbox disconnected)', hasEdits: true, editedByName: 'Sofia Delgado' }],
  ['d2', 'Ben Sample', 'Senior Engineer', { returnedFromSnoozeAt: ago(20) }],
  ['d3', 'Cy Placeholder', 'Product Designer', { expiresAt: new Date(NOW + 2 * 86400_000 + 3600_000).toISOString() }],
  ['d4', 'Dee Fixture', 'Product Designer', { hasEdits: true, editedByName: 'Rae Recruiter' }],
  ['d5', 'Eli Mock', 'Senior Engineer', {}],
];
const items = people.map(([id, name, role, extra], i) => ({
  kind: 'draft', id, view: 'needs_review', sortAt: ago(30 + i * 40), ageMs: (30 + i * 40) * 60_000,
  draft: {
    id, threadId: `t-${id}`, status: 'PENDING', subject: `Re: ${role}`,
    preview: `Hi ${name.split(' ')[0]}, thanks for getting back to me — happy to set up a quick call next week.`,
    classification: 'NEUTRAL', confidence: 0.6, confidenceLabel: 'medium', classificationReason: 'Asks a question about the role',
    evidenceQuote: null, hasEdits: false, editedAt: null, editedByName: null, snoozedUntil: null, returnedFromSnoozeAt: null,
    scheduledSendAt: null, sentAt: null, sendError: null, ccAddress: null, createdAt: ago(600),
    expiresAt: new Date(NOW + 15 * 86400_000).toISOString(), ...extra,
  },
  candidate: { id: `c-${id}`, name, email: `${name.split(' ')[0].toLowerCase()}@example.org`, role, status: 'NEEDS_REVIEW', leverState: 'NOT_FOUND', leverStage: null, leverPostingTitle: null, leverOpportunityId: null },
  mailbox, presence: [],
}));
const counts = { needs_review: 5, interested: 12, not_interested: 7, snoozed: 0, sent_today: 3 };
const draftFor = (it) => {
  const body = `Hi ${it.candidate.name.split(' ')[0]},\n\nThanks for getting back to me! Happy to answer that — the role is hybrid, two days a week in the office.\n\nWould a quick call next Tuesday work?\n\nBest,\nRae`;
  return {
    ...it.draft, bodyText: body, aiBodyText: it.draft.hasEdits ? body + '\n(AI)' : body, updatedAt: ago(10), ccEmail: null, presence: [],
    originalMessage: { id: `m-${it.id}`, fromAddress: it.candidate.email, fromName: it.candidate.name, subject: it.draft.subject, bodyText: 'Thanks! Is the role remote or hybrid?', bodyHtml: null, receivedAt: ago(45) },
    thread: { id: it.draft.threadId, mailboxId: 'mb1', mailbox: { ...mailbox, provider: 'GMAIL' }, externalThreadId: 'x', subject: it.draft.subject, lastMessageAt: ago(45), createdAt: ago(900),
      candidate: { ...it.candidate }, messages: [] },
  };
};
const ok = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });

async function mock(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();
    if (p === '/auth/me') return route.fulfill(ok({ user: { id: 'u1', email: 'rae@archive.com', name: 'Rae Recruiter', role: 'admin' } }));
    if (p === '/inbox') {
      const view = url.searchParams.get('view') ?? 'needs_review';
      const list = view === 'needs_review' ? items : [];
      return route.fulfill(ok({ items: list, counts, roleCounts: [{ role: 'Senior Engineer', count: 3 }, { role: 'Product Designer', count: 2 }], nextCursor: null }));
    }
    if (p === '/drafts/cc-options') return route.fulfill(ok([{ email: null, name: 'No CC', firstName: null }]));
    const m = p.match(/^\/drafts\/(d\d)(\/.*)?$/);
    if (m) {
      const it = items.find((i) => i.id === m[1]);
      if (!m[2] && method === 'GET') return route.fulfill(ok(draftFor(it)));
      if (m[2] === '/presence') return route.fulfill(ok({ presence: [] }));
      if (m[2] === '/dismiss') return route.fulfill(ok({ id: m[1], status: 'DISCARDED' }));
      return route.fulfill(ok({}));
    }
    if (p === '/mailboxes') return route.fulfill(ok([{ ...mailbox, provider: 'GMAIL', isActive: true, authStatus: 'OK', createdAt: ago(9999), updatedAt: ago(1) }]));
    if (p === '/lever/me') return route.fulfill(ok({ configured: false }));
    if (p === '/drafts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], meta: { total: 0, page: 1, limit: 50 } }) });
    if (p === '/coverage') return route.fulfill(ok({ generatedAt: new Date(NOW).toISOString(), windowDays: 30, expectedSenderCount: 1, unmonitored: [], quietMailboxes: [], mailboxes: [] }));
    if (p === '/internal/sync-health') return route.fulfill(ok([]));
    return route.fulfill(ok([]));
  });
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('auth_token', 'shot');
    localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', email: 'rae@archive.com', name: 'Rae Recruiter', role: 'admin' }));
    localStorage.setItem('theme', t);
  }, [theme]);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text().slice(0, 200)));
  page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
  await mock(page);
  await page.goto('http://localhost:4173/inbox?view=needs_review&item=d1');
  try {
    await page.getByRole('region', { name: 'Reply to Ada Example' }).waitFor({ timeout: 8000 });
  } catch (e) {
    console.log('url', page.url());
    await page.screenshot({ path: `${OUT}/debug-${theme}.png` });
    throw e;
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/inbox-flags-${theme}.png` });

  await page.goto('http://localhost:4173/inbox?view=snoozed');
  await page.getByText('Press S on a reply to bring it back later.').waitFor();
  await page.screenshot({ path: `${OUT}/inbox-empty-hint-${theme}.png` });

  await page.goto('http://localhost:4173/inbox?view=needs_review&item=d2');
  await page.getByRole('region', { name: 'Reply to Ben Sample' }).getByRole('button', { name: /Dismiss/ }).click();
  await page.getByRole('menuitem', { name: 'Spam' }).click();
  await page.getByText('Dismissed').first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/inbox-dismiss-undo-${theme}.png` });
  await page.goto('http://localhost:4173/settings/mailboxes#notifications');
  await page.getByRole('region', { name: 'Notifications', exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/settings-notifications-${theme}.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log('done');
