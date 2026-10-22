// R2 Inbox screenshots: every view, light/dark, 1440 + 1024 + 390 (stacked),
// plus pane states (locked, undo toast, dismiss menu, snooze, show changes).
// Runs against `vite dev` with /inbox mounted and every /api/* call served
// from the fake fixtures below — no backend, no real data.
//
//   cd frontend && npx vite --port 5173 &
//   node ../docs/screenshots/r2/capture-inbox.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';

const outDir = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const now = Date.now();
const ago = (m) => new Date(now - m * 60_000).toISOString();
const mailboxes = [
  { id: 'mb1', emailAddress: 'rae@example.com', displayName: 'Rae Recruiter' },
  { id: 'mb2', emailAddress: 'talent@example.com', displayName: 'Talent Team' },
];
const user = { id: 'u1', email: 'rae@example.com', name: 'Rae Recruiter', avatarUrl: null };

const people = {
  n1: ['Ada Example', 'NEUTRAL', 'needs_review', 'Asks about remote work before deciding', 'open to hearing more if it can be remote'],
  n2: ['Ben Sample', 'INTERESTED', 'needs_review', 'Wants to talk this week', 'happy to talk this week'],
  i1: ['Cy Placeholder', 'INTERESTED', 'interested', 'Asks for a call next week', "I'd love to chat next week"],
  i2: ['Dee Fixture', 'INTERESTED', 'interested', 'Shares availability', 'Tuesday afternoon works'],
  i3: ['Eli Mock', 'INTERESTED', 'interested', 'Wants the job description', 'send over the job description'],
  x1: ['Fay Stub', 'NOT_INTERESTED', 'not_interested', 'Happy in current role', 'not looking right now'],
  x2: ['Gus Dummy', 'NOT_INTERESTED', 'not_interested', 'Declines politely', 'pass for now'],
  x3: ['Hal Testcase', 'NOT_INTERESTED', 'not_interested', 'Asks to be removed', 'please take me off'],
  x4: ['Ivy Sample', 'NOT_INTERESTED', 'not_interested', 'Not a fit for the role', 'not the right fit'],
  s1: ['Jo Example', 'INTERESTED', 'snoozed', 'Back from leave in two weeks', 'reach out after the 5th'],
  t1: ['Kai Fixture', 'INTERESTED', 'sent_today', 'Asks for a call', 'call sounds great'],
  t2: ['Lee Mock', 'NOT_INTERESTED', 'sent_today', 'Declines', 'not interested'],
};

function itemFor(id, i) {
  const [name, cls, view, reason, quote] = people[id];
  const first = name.split(' ')[0];
  const status = id === 'n2' ? 'FAILED' : id === 't1' ? 'SENT' : id === 't2' ? 'SCHEDULED' : 'PENDING';
  return {
    kind: 'draft', id, view, sortAt: ago(20 + i * 37), ageMs: (20 + i * 37) * 60_000,
    draft: {
      id, threadId: `t-${id}`, status, subject: 'Re: Senior Engineer at Example Co',
      preview: cls === 'NOT_INTERESTED' ? `Hi ${first}, totally understand — thanks for letting me know.` : `Hi ${first}, great to hear from you! Let's find a time.`,
      classification: cls, confidence: cls === 'NEUTRAL' ? 0.55 : 0.91, confidenceLabel: cls === 'NEUTRAL' ? 'low' : 'high',
      classificationReason: reason, evidenceQuote: quote, hasEdits: false, editedAt: null,
      snoozedUntil: view === 'snoozed' ? new Date(now + 5 * 86400_000).toISOString() : null, returnedFromSnoozeAt: null,
      scheduledSendAt: status === 'SCHEDULED' ? new Date(now + 8000).toISOString() : null, sentAt: status === 'SENT' ? ago(12) : null,
      sendError: status === 'FAILED' ? 'Gmail rejected the send (quota). Check Gmail Sent before retrying.' : null,
      ccAddress: cls === 'INTERESTED' ? 'hana@example.com' : null, createdAt: ago(20 + i * 37),
    },
    candidate: {
      id: `c-${id}`, name, email: `${first.toLowerCase()}@example.org`, role: 'Senior Engineer', status: cls,
      leverState: i % 3 === 0 ? 'ACTIVE' : 'NOT_FOUND', leverStage: i % 3 === 0 ? 'Phone Screen' : null,
      leverPostingTitle: i % 3 === 0 ? 'Senior Engineer' : null, leverOpportunityId: i % 3 === 0 ? 'opp1' : null,
    },
    mailbox: mailboxes[i % 2],
    presence: id === 'i2' ? [{ userId: 'u2', name: 'Sofia Example', mode: 'editing' }] : [],
  };
}
const items = Object.keys(people).map(itemFor);
items.push({
  kind: 'candidate', id: 'cand-z', view: 'needs_review', sortAt: ago(300), ageMs: 300 * 60_000, draft: null,
  candidate: { id: 'cand-z', name: 'Max Placeholder', email: 'max@example.org', role: null, status: 'NEEDS_REVIEW', leverState: null, leverStage: null, leverPostingTitle: null, leverOpportunityId: null },
  mailbox: mailboxes[0], presence: [],
});

function draftFor(it) {
  const d = it.draft; const c = it.candidate; const first = c.name.split(' ')[0];
  const ai = d.classification === 'NOT_INTERESTED'
    ? `Hi ${first},\n\nTotally understand — thanks for letting me know. I'll keep you in mind for future roles.\n\nBest,\nRae`
    : `Hi ${first},\n\nGreat to hear from you! I'm looping in Hana from the recruitment team, who will coordinate timing for a first call.\n\nBest,\nRae`;
  return {
    id: d.id, threadId: d.threadId, subject: d.subject, bodyText: ai, aiBodyText: ai, classification: d.classification,
    confidence: d.confidence, confidenceLabel: d.confidenceLabel, classificationReason: d.classificationReason, evidenceQuote: d.evidenceQuote,
    status: d.status, sendError: d.sendError, snoozedUntil: d.snoozedUntil, sentAt: d.sentAt, scheduledSendAt: d.scheduledSendAt,
    createdAt: d.createdAt, updatedAt: d.createdAt, ccAddress: d.ccAddress, ccEmail: d.ccAddress, presence: it.presence,
    originalMessage: { id: `m-${d.id}`, fromAddress: c.email, fromName: c.name, subject: d.subject,
      bodyText: `Hi Rae,\n\nThanks for reaching out — ${d.evidenceQuote}. Let me know what you think.\n\n${first}`, bodyHtml: null, receivedAt: ago(45) },
    thread: { id: d.threadId, mailboxId: it.mailbox.id, mailbox: { ...it.mailbox, provider: 'GMAIL' }, externalThreadId: 'x', subject: 'Senior Engineer', lastMessageAt: ago(45), createdAt: ago(5000),
      candidate: { id: c.id, name: c.name, email: c.email, status: c.status, role: c.role, leverState: c.leverState },
      messages: [
        { id: `m-${d.id}`, fromAddress: c.email, fromName: c.name, toAddresses: [], subject: d.subject, bodyText: '…', receivedAt: ago(45), headers: {}, createdAt: ago(45) },
        { id: `m0-${d.id}`, fromAddress: it.mailbox.emailAddress, fromName: 'Rae', toAddresses: [c.email], subject: 'Senior Engineer', bodyText: `Hi ${first}! We're hiring a Senior Engineer at Example Co — would you be open to a chat?`, receivedAt: ago(5000), headers: {}, createdAt: ago(5000) },
      ] },
  };
}

const views = ['needs_review', 'interested', 'not_interested', 'snoozed', 'sent_today'];
const ok = (data, extra = {}) => ({ success: true, data, ...extra });
function respond(method, path, url) {
  if (path === '/api/auth/me') return [200, ok({ user })];
  if (path === '/api/inbox') {
    const view = url.searchParams.get('view') ?? 'needs_review';
    const empty = url.searchParams.get('mailbox') === 'none' || url.searchParams.get('mailboxId') === 'none';
    const counts = Object.fromEntries(views.map((v) => [v, items.filter((i) => i.view === v).length]));
    return [200, ok({ items: empty ? [] : items.filter((i) => i.view === view), counts, nextCursor: null })];
  }
  if (path === '/api/mailboxes') return [200, ok(mailboxes.map((m) => ({ ...m, provider: 'GMAIL', isActive: true, createdAt: ago(9e4), updatedAt: ago(5) })))];
  if (path === '/api/views') return [200, ok([{ id: 'v1', userId: null, name: 'Talent — interested', scope: 'inbox', filters: { view: 'interested', mailboxId: 'mb2' }, shared: true, createdAt: ago(99), updatedAt: ago(9) }])];
  if (path === '/api/lever/me') return [200, ok({ configured: true, createEnabled: true, leverUser: { id: 'lu1', name: 'Rae' }, appEmail: 'rae@example.com' })];
  if (path === '/api/drafts/cc-options') return [200, ok([{ email: null, name: 'No CC', firstName: null }, { email: 'hana@example.com', name: 'Hana Example', firstName: 'Hana' }])];
  const presence = path.match(/^\/api\/drafts\/(\w+)\/presence$/);
  if (presence) return [200, ok({ presence: presence[1] === 'i2' ? [{ userId: 'u2', name: 'Sofia Example', mode: 'editing' }] : [] })];
  const send = path.match(/^\/api\/drafts\/(\w+)\/send$/);
  if (send && method === 'POST') {
    if (send[1] === 'i2') return [423, { success: false, error: 'Sofia Example is editing this draft', lockedBy: 'Sofia Example' }];
    return [202, ok({ id: send[1], status: 'SCHEDULED', scheduledSendAt: new Date(Date.now() + 10_000).toISOString(), undoSeconds: 10 })];
  }
  const d = path.match(/^\/api\/drafts\/(\w+)$/);
  if (d) { const it = items.find((x) => x.id === d[1]); return it ? [200, ok(draftFor(it))] : [404, { success: false }]; }
  const cand = path.match(/^\/api\/candidates\/([\w-]+)$/);
  if (cand) return [200, ok({ id: cand[1], name: 'Max Placeholder', email: 'max@example.org', status: 'NEEDS_REVIEW', threads: [{ id: 'tz', messages: [{ id: 'mz', fromAddress: 'max@example.org', fromName: 'Max Placeholder', bodyText: 'Maybe — what is the comp range?', receivedAt: ago(300) }] }] })];
  return [200, ok([])];
}

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 1024, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme: theme });
    await ctx.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      const [status, body] = respond(route.request().method(), url.pathname, url);
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem('theme', t);
      localStorage.setItem('auth_token', 'fake');
      localStorage.setItem('auth_user', JSON.stringify(u));
    }, [theme, user]);
    const page = await ctx.newPage();
    const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: `${outDir}/${name}-${width}-${theme}.png` }); };
    const go = async (q) => { await page.goto(`${base}/inbox${q}`); await page.waitForLoadState('networkidle'); };

    if (width === 390) {
      await go('?view=interested'); await shot('stacked-list');
      await go('?view=interested&item=i1'); await shot('stacked-pane');
      await ctx.close();
      continue;
    }
    for (const v of views) { await go(`?view=${v}`); await shot(`view-${v}`); }
    await go('?view=needs_review&item=n1'); await shot('pane-unsure');
    await go('?view=needs_review&item=n2'); await shot('pane-failed');
    await go('?view=needs_review&item=candidate:cand-z'); await shot('pane-candidate');
    await go('?view=snoozed&item=s1'); await shot('pane-snoozed');
    await go('?view=sent_today&item=t2'); await shot('pane-scheduled');
    await go('?view=interested&mailbox=none'); await shot('empty');

    await go('?view=interested&item=i1'); await shot('pane-interested');
    await page.getByRole('button', { name: /^Dismiss/ }).click(); await shot('dismiss-menu');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Snooze/ }).click(); await shot('snooze-menu');
    await page.keyboard.press('Escape');
    const box = page.getByRole('textbox', { name: 'Reply' });
    await box.fill("Hi Cy,\n\nGreat to hear from you! Hana from our team will reach out to set up a 30-minute call this week.\n\nBest,\nRae");
    await page.getByRole('button', { name: 'Show changes' }).click(); await shot('show-changes');
    await page.getByRole('button', { name: 'Show changes' }).click();
    await page.getByRole('button', { name: /^Send/ }).click(); await shot('undo-toast');

    await go('?view=interested&item=i2');
    await page.getByRole('button', { name: /^Send/ }).click(); await page.getByText('is editing this reply').waitFor(); await shot('locked');

    await go('?view=not_interested');
    await page.getByRole('checkbox', { name: 'Select all' }).click(); await shot('batch-selected');
    await page.getByRole('button', { name: /^Send \d+ replies$/ }).click(); await shot('batch-dialog');
    await page.keyboard.press('Escape');
    await page.keyboard.press('?'); await shot('help');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+k'); await shot('palette');
    await ctx.close();
  }
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
