// R3 Candidates screenshots: table, hover actions, side panel, bulk bar,
// saved views (+ save dialog) and the ⌘K lookup card, light/dark at 1440,
// 1024 and 390. Runs against `vite dev` with every /api/* call served from
// the fake fixtures below — no backend, no real data.
//
//   cd frontend && npx vite --port 5173 &
//   node ../docs/screenshots/r3/capture-candidates.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const now = Date.now();
const ago = (h) => new Date(now - h * 3600_000).toISOString();
const mailboxes = [
  { id: 'mb1', emailAddress: 'rae@example.com', provider: 'GMAIL' },
  { id: 'mb2', emailAddress: 'talent@example.com', provider: 'GMAIL' },
];
const user = { id: 'u1', email: 'rae@example.com', name: 'Rae Recruiter', avatarUrl: null, role: 'admin' };

const rows = [
  ['Ada Example', 'INTERESTED', 'Senior Engineer', { leverState: 'ACTIVE', leverOpportunityId: 'opp1', leverPostingTitle: 'Senior Engineer', leverStage: 'Phone Screen' }, 2, 5],
  ['Ben Sample', 'NEEDS_REVIEW', 'Product Designer', { leverState: 'NOT_FOUND' }, 6, 30],
  ['Cy Placeholder', 'NOT_INTERESTED', 'Senior Engineer', { leverState: 'ARCHIVED', leverOpportunityId: 'opp2', leverArchivedReason: 'Withdrew' }, 50, 20],
  ['Dee Fixture', 'NEUTRAL', null, { leverState: null }, 26, 30],
  ['Eli Mock', 'PENDING', 'Founding Engineer', { leverState: 'NOT_FOUND' }, null, 70],
  ['Fay Stub', 'INTERESTED', 'Founding Engineer', { leverState: 'NOT_FOUND' }, 9, 12],
  ['Gus Dummy', 'INTERESTED', 'Senior Engineer', { leverState: 'HIRED', leverOpportunityId: 'opp3', leverPostingTitle: 'Senior Engineer' }, 120, 100],
  ['Hal Testcase', 'NEEDS_REVIEW', 'Product Designer', { leverState: 'ERROR', leverError: 'timeout' }, 3, 40],
];
const candidates = rows.map(([name, status, role, lever, inH, outH], i) => ({
  id: `c${i}`, name, email: `${name.split(' ')[0].toLowerCase()}@example.org`, status, role,
  mailboxId: mailboxes[i % 2].id, mailbox: mailboxes[i % 2],
  lastInboundAt: inH == null ? null : ago(inH), lastOutboundAt: ago(outH),
  replyStatus: inH != null && inH < outH ? 'AWAITING_REPLY' : inH == null ? 'NEW' : 'REPLIED',
  createdAt: ago(500), updatedAt: ago(i), leverCheckedAt: ago(1), ...lever,
}));

function detail(c) {
  const first = c.name.split(' ')[0];
  const mb = c.mailbox.emailAddress;
  const msg = (id, from, h, body, subject) => ({ id, threadId: 't', mailboxId: c.mailboxId, externalMessageId: id, fromAddress: from, fromName: from === c.email ? c.name : 'Rae Recruiter', toAddresses: [], subject, bodyText: body, bodyHtml: null, receivedAt: ago(h), headers: {}, createdAt: ago(h) });
  return {
    ...c,
    threads: [
      { id: `t1-${c.id}`, subject: `${c.role ?? 'Engineer'} at Example Co`, lastMessageAt: ago(2), mailboxId: c.mailboxId, externalThreadId: 'x', createdAt: ago(90),
        messages: [
          msg('m1', mb, 90, `Hi ${first},\n\nWe're hiring a ${c.role ?? 'engineer'} at Example Co — would you be open to a quick chat?\n\nRae`, `${c.role ?? 'Engineer'} at Example Co`),
          msg('m2', c.email, 2, `Hi Rae,\n\nThanks for reaching out — this sounds interesting. Next week works for me.\n\n${first}`, `Re: ${c.role ?? 'Engineer'} at Example Co`),
        ],
        drafts: [{ id: `d-${c.id}`, status: 'PENDING', createdAt: ago(1), threadId: `t1-${c.id}` }] },
      { id: `t0-${c.id}`, subject: 'Earlier outreach', lastMessageAt: ago(900), mailboxId: c.mailboxId, externalThreadId: 'y', createdAt: ago(950),
        messages: [msg('m0', 'talent@example.com', 950, `Hi ${first} — reaching out about a design role last spring.`, 'Earlier outreach')],
        drafts: [] },
    ],
  };
}

const savedViews = [
  { id: 'v-team', userId: null, name: 'Eng pipeline', scope: 'candidates', filters: { status: 'INTERESTED', lever: 'IN' }, shared: true, createdAt: ago(99), updatedAt: ago(9) },
  { id: 'v-mine', userId: 'u1', name: 'My unsure', scope: 'candidates', filters: { status: 'NEUTRAL' }, shared: false, createdAt: ago(99), updatedAt: ago(9) },
];
const lookupUnknown = {
  email: 'new.person@example.net', verdict: 'UNKNOWN', summary: 'No trace of this email in any connected mailbox', candidate: null,
  messages: { inbound: 0, outbound: 0, firstAt: null, lastAt: null, latestSubject: null, latestThreadId: null, mailboxes: [], truncated: false },
  drafts: { total: 0, byStatus: {}, latest: null }, skipped: { reasons: [], lastSkippedAt: null, windowDays: 30 },
  integrations: { lever: { status: 'NOT_FOUND', state: 'NOT_FOUND', primary: null, opportunities: [], opportunityCount: 0, checkedAt: ago(0) } },
};

const ok = (data, extra = {}) => ({ success: true, data, ...extra });
function respond(path, url) {
  if (path === '/api/auth/me') return ok({ user });
  if (path === '/api/candidates') {
    const status = url.searchParams.get('status');
    const list = status ? candidates.filter((c) => c.status === status) : candidates;
    return ok(list, { meta: { total: status ? list.length : 312, page: 1, limit: 50 } });
  }
  const one = path.match(/^\/api\/candidates\/(c\d)$/);
  if (one) return ok(detail(candidates.find((c) => c.id === one[1])));
  if (path === '/api/views') return ok(savedViews);
  if (path === '/api/drafts') return ok([], { meta: { total: 4, page: 1, limit: 1 } });
  if (path === '/api/inbox') return ok({ items: [], counts: { needs_review: 4, interested: 2, not_interested: 1, snoozed: 0, sent_today: 3 }, nextCursor: null });
  if (path === '/api/lookup') return ok(lookupUnknown);
  if (path === '/api/mailboxes') return ok(mailboxes.map((m) => ({ ...m, isActive: true, createdAt: ago(9e3), updatedAt: ago(5) })));
  if (path === '/api/lever/me') return ok({ configured: true, createEnabled: true, appEmail: user.email, leverUser: { id: 'lu1', name: user.name } });
  if (path === '/api/integrations/gem/status') return ok({ status: 'OK', lastError: null });
  return ok([]);
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 1024, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme });
    await ctx.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(url.pathname, url)) });
    });
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem('theme', t);
      localStorage.setItem('auth_token', 'fake');
      localStorage.setItem('auth_user', JSON.stringify(u));
    }, [theme, user]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}-${width}-${theme}.png` }); };
    const go = async (q = '') => { await page.goto(`${base}/candidates${q}`); await page.waitForLoadState('networkidle'); };

    await go(); await shot('table');
    if (width !== 390) {
      await page.getByTestId('candidate-row').nth(1).hover(); await shot('hover-actions');
      await page.getByRole('button', { name: 'More actions for Ben Sample' }).click(); await shot('row-menu');
      await page.keyboard.press('Escape');
    }
    await page.getByRole('checkbox', { name: 'Select Ada Example' }).click();
    await page.getByRole('checkbox', { name: 'Select Fay Stub' }).click();
    await shot('bulk-bar');
    await go('?view=v-team&status=INTERESTED&lever=IN'); await shot('saved-view-team');
    await go('?lever=NOT_IN&q=ex'); await shot('filter-chips');
    await page.getByRole('button', { name: 'Save view' }).click(); await shot('save-view-dialog');
    await page.keyboard.press('Escape');
    await go('?candidate=c0'); await shot('side-panel');
    await go();
    await page.keyboard.press('Meta+k');
    await page.getByRole('combobox', { name: /email to look up/i }).fill('new.person@example.net');
    await page.waitForTimeout(900); await shot('lookup-card-unknown');
    await ctx.close();
  }
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
