// R1 shell screenshots: every top-level route, Settings pages, the status
// banner and the ⌘K palette, light + dark, at 1280 and 390 px wide.
// `before` drives the pre-R1 tab URLs, `after` the new routes.
//
//   cd frontend && npx vite --port 5173 &
//   node capture-r1.mjs <before|after> <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { respond, user } from './fixtures.mjs';

const mode = process.argv[2] ?? 'after';
const outDir = process.argv[3] ?? `shots-${mode}`;
const base = process.argv[4] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const ROUTES = {
  before: [
    ['dashboard', '/'],
    ['candidates', '/?tab=candidates'],
    ['drafts', '/?tab=drafts'],
  ],
  after: [
    ['inbox', '/inbox'],
    ['candidates', '/candidates'],
    ['today', '/today'],
    ['settings-mailboxes', '/settings/mailboxes'],
    ['settings-integrations', '/settings/integrations'],
    ['settings-team', '/settings/team'],
  ],
}[mode];

const browser = await chromium.launch();
for (const width of [1280, 390]) {
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, colorScheme: theme });
    await ctx.route('**/api/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respond(path)) });
    });
    await ctx.route('https://accounts.google.com/**', (r) => r.abort());
    await ctx.addInitScript((t) => { localStorage.setItem('theme', t); }, theme);
    const page = await ctx.newPage();
    const shot = async (name) => {
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${outDir}/${name}-${width}-${theme}.png` });
    };

    await page.goto(`${base}/login`); await shot('login');
    await page.evaluate((u) => { localStorage.setItem('auth_token', 'fake'); localStorage.setItem('auth_user', JSON.stringify(u)); }, user);
    for (const [name, path] of ROUTES) {
      await page.goto(`${base}${path}`); await page.waitForLoadState('networkidle'); await shot(name);
    }
    await page.goto(`${base}${ROUTES[0][1]}`); await page.waitForLoadState('networkidle');
    await page.keyboard.press('Meta+k'); await shot('cmdk');
    await page.keyboard.press('Escape');
    if (mode === 'after') {
      await page.keyboard.press('Shift+?'); await shot('shortcuts');
      await page.keyboard.press('Escape');
      if (width < 768) {
        await page.getByRole('button', { name: /toggle sidebar/i }).first().click(); await shot('mobile-nav');
      }
    }
    await ctx.close();
  }
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
