// U2a screenshots: Candidates (+ side panel), Today, Settings → Mailboxes
// (Details open, admin) and Integrations — light + dark at 1440 and 390 px.
// Every /api/* call comes from fixtures.mjs (no backend, no real data).
//
//   cd frontend && npx vite --port 5173 &
//   node capture-u2a.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { respond, user } from './fixtures.mjs';

const outDir = process.argv[2] ?? 'shots-u2a';
const base = process.argv[3] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const ago = (h) => new Date(Date.now() - h * 3600_000).toISOString();
function candidateDetail(id) {
  const c = respond('/api/candidates').data.find((x) => x.id === id);
  const msg = (mid, from, h, body) => ({ id: mid, threadId: 't0', mailboxId: c.mailboxId, externalMessageId: mid, fromAddress: from, fromName: from.split('@')[0], toAddresses: [], subject: `${c.role ?? 'Opportunity'} at Example Co`, bodyText: body, bodyHtml: null, receivedAt: ago(h), headers: {}, createdAt: ago(h) });
  return { ...c, threads: [{ id: 't0', subject: `${c.role ?? 'Opportunity'} at Example Co`, lastMessageAt: ago(1), drafts: [], messages: [msg('m1', c.mailbox.emailAddress, 30, 'Hi — would you be open to a quick chat about the role?'), msg('m2', c.email, 2, 'Sounds interesting — happy to chat next week.')] }] };
}

const PAGES = [
  ['candidates', '/candidates'],
  ['candidate-panel', '/candidates?candidate=c1'],
  ['today', '/today'],
  ['settings-mailboxes', '/settings/mailboxes'],
  ['settings-integrations', '/settings/integrations'],
];

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await ctx.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      const m = path.match(/^\/api\/candidates\/(c\d)$/);
      const body = m
        ? { success: true, data: candidateDetail(m[1]) }
        : path === '/api/auth/me'
          ? { success: true, data: { user: { ...user, role: 'admin' } } }
          : respond(path);
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await ctx.addInitScript(([t, u]) => {
      localStorage.setItem('theme', t);
      localStorage.setItem('auth_token', 'fake');
      localStorage.setItem('auth_user', JSON.stringify({ ...u, role: 'admin' }));
    }, [theme, user]);
    const page = await ctx.newPage();
    for (const [name, path] of PAGES) {
      await page.goto(`${base}${path}`);
      await page.waitForLoadState('networkidle');
      if (name === 'settings-mailboxes') {
        await page.getByRole('button', { name: /^Details for recruiter@/ }).click();
      }
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${outDir}/${name}-${width}-${theme}.png`, fullPage: true });
    }
    if (width === 1440) {
      // Disconnect confirm + the darker focus ring on a keyboard-focused button.
      await page.goto(`${base}/settings/mailboxes`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: /^Disconnect recruiter@/ }).click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${outDir}/settings-disconnect-confirm-${width}-${theme}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${outDir}/focus-ring-${width}-${theme}.png`, clip: { x: 0, y: 0, width: 900, height: 120 } });
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
