// U2b screenshots: built SPA via `vite preview`, /api mocked with page.route.
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
const draftItems = people.map(([id, name, role, extra], i) => ({
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
const fay = { kind: 'candidate', id: 'c-fay', view: 'needs_review', sortAt: ago(10), ageMs: 600_000, draft: null,
  candidate: { id: 'c-fay', name: 'Fay Stub', email: 'fay@example.org', role: 'Senior Engineer', status: 'NEEDS_REVIEW', leverState: 'NOT_FOUND', leverStage: null, leverPostingTitle: null, leverOpportunityId: null },
  mailbox, presence: [] };
const items = [fay, ...draftItems];
const counts = { needs_review: 6, interested: 12, not_interested: 7, snoozed: 0, sent_today: 3 };
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
    if (p === '/candidates/c-fay') return route.fulfill(ok({ id: 'c-fay', name: 'Fay Stub', email: 'fay@example.org', status: 'NEEDS_REVIEW', threads: [{ id: 't-fay', drafts: [], messages: [{ id: 'm-fay', fromAddress: 'fay@example.org', fromName: 'Fay Stub', bodyText: "Maybe? I'm happy where I am but open to hearing more about the team.", receivedAt: ago(10) }] }] }));
    if (p === '/mailboxes') return route.fulfill(ok([{ ...mailbox, provider: 'GMAIL', isActive: true, authStatus: 'OK', createdAt: ago(9999), updatedAt: ago(1) }]));
    if (p === '/lever/me') return route.fulfill(ok({ configured: false }));
    if (p === '/drafts') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [], meta: { total: 0, page: 1, limit: 50 } }) });
    if (p === '/coverage') return route.fulfill(ok({ generatedAt: new Date(NOW).toISOString(), windowDays: 30, expectedSenderCount: 1, unmonitored: [], quietMailboxes: [], mailboxes: [] }));
    if (p === '/internal/sync-health') return route.fulfill(ok([]));
    return route.fulfill(ok([]));
  });
}


const BASE = 'http://localhost:4173';
const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const [vw, vh, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, colorScheme: theme });
    await ctx.addInitScript(([t]) => {
      localStorage.setItem('auth_token', 'shot');
      localStorage.setItem('auth_user', JSON.stringify({ id: 'u1', email: 'rae@archive.com', name: 'Rae Recruiter', role: 'admin' }));
      localStorage.setItem('theme', t);
    }, [theme]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror:', e.message.slice(0, 200)));
    await mock(page);
    const shot = (name) => page.screenshot({ path: `${OUT}/${name}-${theme}-${tag}.png` });

    // Reply pane: candidate name is a link; Lever + Why scroll with the body.
    await page.goto(`${BASE}/inbox?view=needs_review&item=d2`);
    await page.getByRole('region', { name: 'Reply to Ben Sample' }).waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await shot('reply-pane');

    // Snooze presets labelled in ET.
    await page.keyboard.press('s');
    await page.getByRole('menuitem', { name: /Later today/ }).waitFor();
    await page.waitForTimeout(200);
    await shot('snooze-et');
    await page.keyboard.press('Escape');

    // ⌘K: Open candidate for the current reply.
    await page.keyboard.press('Meta+k');
    await page.getByRole('option', { name: /Open candidate/ }).waitFor();
    await page.waitForTimeout(200);
    await shot('palette-open-candidate');
    await page.keyboard.press('Escape');

    // Needs-decision candidate: I / N / D hints, Hide candidate tooltip.
    await page.goto(`${BASE}/inbox?view=needs_review&item=candidate:c-fay`);
    const pane = page.getByRole('region', { name: 'Reply to Fay Stub' });
    await pane.getByText(/happy where I am/).waitFor();
    if (vw > 500) {
      await pane.getByRole('button', { name: /Hide candidate/ }).hover();
      await page.getByRole('tooltip').waitFor();
    }
    await page.waitForTimeout(300);
    await shot('candidate-pane');

    // Keyboard cursor ring on the list.
    await page.goto(`${BASE}/inbox?view=needs_review`);
    await page.getByRole('button', { name: /Ada Example/ }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    await shot('cursor-ring');

    // One shortcuts dialog.
    await page.keyboard.press('Shift+?');
    await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).waitFor();
    await page.waitForTimeout(300);
    await shot('shortcuts');
    await ctx.close();
  }
}
await browser.close();
console.log('done');
