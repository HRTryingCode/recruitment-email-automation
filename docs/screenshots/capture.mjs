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

import { respond, user } from './fixtures.mjs';

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
