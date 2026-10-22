// Visual-regression screenshots for the design-system batches (R0–R4).
// Runs against `vite dev` (default http://localhost:5173) with every /api/*
// call fulfilled from the fake fixtures below — no backend, no real data.
//
//   cd frontend && npx vite --port 5173 &
//   node capture.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const now = Date.now();
const ago = (h) => new Date(now - h * 3600_000).toISOString();
const mailbox = { id: 'mb1', provider: 'GMAIL', emailAddress: 'recruiter@example.com', displayName: 'Rae Recruiter', isActive: true, createdAt: ago(900), updatedAt: ago(2) };
const mailbox2 = { ...mailbox, id: 'mb2', emailAddress: 'talent@example.com', displayName: 'Talent Team' };
const statuses = ['INTERESTED', 'NEEDS_REVIEW', 'NOT_INTERESTED', 'NEUTRAL', 'PENDING', 'REPLIED'];
const lever = [
  { leverState: 'ACTIVE', leverStage: 'Phone Screen', leverPostingTitle: 'Senior Engineer', leverCheckedAt: ago(1) },
  { leverState: 'NOT_FOUND', leverCheckedAt: ago(1) },
  { leverState: 'ARCHIVED', leverArchivedReason: 'Withdrew', leverCheckedAt: ago(2) },
  { leverState: null },
];
const names = ['Ada Example', 'Ben Sample', 'Cy Placeholder', 'Dee Fixture', 'Eli Mock', 'Fay Stub', 'Gus Dummy', 'Hal Testcase'];
const candidates = names.map((name, i) => ({
  id: `c${i}`, name, email: `${name.split(' ')[0].toLowerCase()}@example.org`,
  company: ['Acme', 'Globex', 'Initech', 'Umbrella'][i % 4], title: 'Engineer', role: ['Senior Engineer', 'Product Designer', null][i % 3],
  status: statuses[i % statuses.length], mailboxId: i % 2 ? 'mb2' : 'mb1', mailbox: i % 2 ? mailbox2 : mailbox,
  lastInboundAt: ago(i * 7 + 1), lastOutboundAt: ago(i * 7 + (i % 2 ? 3 : 0.5)),
  replyStatus: ['AWAITING_REPLY', 'REPLIED', 'NEW'][i % 3], repliedAt: i % 3 === 1 ? ago(i) : null,
  createdAt: ago(200 + i), updatedAt: ago(i), ...lever[i % lever.length],
}));
const drafts = candidates.slice(0, 5).map((c, i) => ({
  id: `d${i}`, threadId: `t${i}`, subject: `Re: ${c.role ?? 'Opportunity'} at Example Co`,
  bodyText: `Hi ${c.name.split(' ')[0]},\n\nThanks for getting back to me! I'd love to set up a quick call to tell you more about the role.\n\nBest,\nRae`,
  classification: ['INTERESTED', 'NEUTRAL', 'NOT_INTERESTED'][i % 3], confidence: 0.92 - i * 0.07, status: 'PENDING',
  createdAt: ago(i * 5 + 1), updatedAt: ago(i), expiresAt: new Date(now + 20 * 86400_000).toISOString(),
  ccAddress: i % 2 ? 'hm@example.com' : null, ccEmail: null,
  thread: { id: `t${i}`, mailboxId: c.mailboxId, mailbox: c.mailbox, externalThreadId: `x${i}`, subject: `${c.role ?? 'Opportunity'} at Example Co`, lastMessageAt: ago(i), createdAt: ago(100),
    candidate: { id: c.id, name: c.name, email: c.email, status: c.status, role: c.role } },
  originalMessage: { id: `m${i}`, fromAddress: c.email, fromName: c.name, subject: `Re: ${c.role ?? 'Opportunity'}`, bodyText: 'Sounds interesting — happy to chat next week.', bodyHtml: null, receivedAt: ago(i * 5 + 2) },
}));
const syncHealth = [mailbox, mailbox2].map((m, i) => ({
  mailboxId: m.id, emailAddress: m.emailAddress, displayName: m.displayName, isActive: true, authStatus: i ? 'NEEDS_REAUTH' : 'OK',
  lastAuthError: i ? 'invalid_grant' : null, lastAuthErrorAt: i ? ago(5) : null, watchExpiry: new Date(now + 86400_000 * 5).toISOString(),
  watchExpiresInHours: 120, lastSyncedMessageAt: ago(0.2), lastReconciliationAt: ago(1), lastReconciliationFoundMissing: 0, lastReconcileError: null,
  consecutiveReconcileFailures: 0, messagesLast24h: 42 - i * 30, totalMessages: 1800, totalCandidates: 310, pendingDrafts: 5, candidatesNeedsReview: 3,
  webhookErrorsLast24h: 0, lastWebhookError: null, error: false,
}));
const coverage = { generatedAt: ago(0), windowDays: 30, expectedSenderCount: 3,
  unmonitored: [{ emailAddress: 'sourcer@example.com', displayName: 'Sam Sourcer', sources: ['gem'], expectedSends30d: 120 }],
  quietMailboxes: [], mailboxes: [mailbox, mailbox2].map((m) => ({ id: m.id, emailAddress: m.emailAddress, displayName: m.displayName, sendAsAddresses: [], sendAsSyncedAt: ago(3), authStatus: 'OK', outbound30d: 200 })) };
const counts = { candidates: 312, awaitingReply: 14, needsReview: 3, pendingDrafts: 5, byMailbox: [] };
const user = { id: 'u1', email: 'rae@example.com', name: 'Rae Recruiter', avatarUrl: null };

const ok = (data, extra = {}) => ({ success: true, data, ...extra });
function respond(path) {
  if (path === '/api/auth/me') return ok({ user });
  if (path === '/api/mailboxes') return ok([mailbox, mailbox2]);
  if (path === '/api/candidates/counts') return ok(counts);
  if (path === '/api/candidates') return ok(candidates, { meta: { total: candidates.length, page: 1, limit: 50 } });
  if (path === '/api/drafts/cc-options') return ok([{ email: null, name: 'No CC', firstName: null }, { email: 'hm@example.com', name: 'Hana Manager', firstName: 'Hana' }]);
  if (path === '/api/drafts') return ok(drafts, { meta: { total: drafts.length, page: 1, limit: 50 } });
  const d = path.match(/^\/api\/drafts\/(d\d)$/); if (d) return ok(drafts.find((x) => x.id === d[1]));
  if (path === '/api/internal/sync-health') return ok(syncHealth);
  if (path === '/api/coverage') return ok(coverage);
  if (path === '/api/coverage/expected-senders') return ok([]);
  if (path.startsWith('/api/emails/threads/')) return ok({ ...drafts[0].thread, messages: [] });
  if (path.startsWith('/api/mailboxes/') && path.endsWith('/signature')) return ok({ signatureHtml: null });
  return ok([]);
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  await ctx.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(path)) });
  });
  // Block Google Identity script so Login renders deterministically offline.
  await ctx.route('https://accounts.google.com/**', (r) => r.abort());
  await ctx.addInitScript((t) => { localStorage.setItem('theme', t); }, theme);
  const page = await ctx.newPage();
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: `${outDir}/${name}-${theme}.png`, fullPage: true }); };

  await page.goto(`${base}/login`); await shot('login');
  await page.evaluate((u) => { localStorage.setItem('auth_token', 'fake'); localStorage.setItem('auth_user', JSON.stringify(u)); }, user);
  await page.goto(`${base}/`); await page.waitForLoadState('networkidle'); await shot('dashboard');
  await page.getByRole('button', { name: 'Account menu' }).click(); await shot('dashboard-menu-open');
  await page.keyboard.press('Escape');
  await page.goto(`${base}/?tab=candidates`); await page.waitForLoadState('networkidle'); await shot('candidates');
  await page.goto(`${base}/?tab=drafts`); await page.waitForLoadState('networkidle'); await shot('drafts');
  await page.goto(`${base}/?tab=drafts&draftId=d0`); await page.waitForLoadState('networkidle'); await shot('drafts-review');
  // ui/select is where the preset's menuColor shows up.
  await page.getByRole('combobox').filter({ hasText: /CC/ }).first().click(); await shot('drafts-cc-select-open');
  await ctx.close();
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
