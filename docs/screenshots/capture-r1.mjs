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

// Full-taupe check: scan the computed colours of every element on the page
// and report anything in the violet hue band (the old brand purple).
async function purpleHits(page) {
  return page.evaluate(() => {
    const toRgb = (v) => {
      let m = v.match(/rgba?\(([\d.]+),? ([\d.]+),? ([\d.]+)/);
      if (m) return [+m[1], +m[2], +m[3]];
      m = v.match(/color\(srgb ([\d.-]+) ([\d.-]+) ([\d.-]+)/);
      if (m) return [m[1] * 255, m[2] * 255, m[3] * 255];
      return null;
    };
    const purple = (v) => {
      const ok = v.match(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)/);
      if (ok) return +ok[2] > 0.05 && +ok[3] >= 260 && +ok[3] <= 330;
      const rgb = toRgb(v);
      if (!rgb) return false;
      const [r, g, b] = rgb.map((x) => x / 255);
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d < 0.08) return false;
      const l = (max + min) / 2, sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
      return h >= 250 && h <= 320 && sat > 0.25;
    };
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'outlineColor', 'boxShadow', 'backgroundImage', 'fill', 'stroke']) {
        if (purple(cs[prop])) hits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${prop}=${cs[prop]}`);
      }
    }
    return hits;
  });
}
const allHits = [];

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
      for (const h of await purpleHits(page)) allHits.push(`${name}-${width}-${theme}: ${h}`);
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
      await page.getByRole('button', { name: 'Account menu' }).click(); await shot('account-menu');
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
console.log(`purple computed colours: ${allHits.length}`);
for (const h of allHits.slice(0, 40)) console.log('  ' + h);
if (mode === 'after' && allHits.length) process.exitCode = 1;
