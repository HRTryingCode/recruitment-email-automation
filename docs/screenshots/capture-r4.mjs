// R4 Today page screenshots: light + dark at 1440 and 390 px, plus the
// fresh-install empty state. Every /api/* call comes from fixtures.mjs.
//
//   cd frontend && npx vite --port 5173 &
//   node capture-r4.mjs <outDir> [baseUrl]
import { chromium } from 'playwright';
import fs from 'node:fs';
import { respond, today, user } from './fixtures.mjs';

const outDir = process.argv[2] ?? 'shots-r4';
const base = process.argv[3] ?? 'http://localhost:5173';
fs.mkdirSync(outDir, { recursive: true });

const EMPTY = {
  ...today,
  views: { needs_review: 0, interested: 0, not_interested: 0 },
  sentToday: 0, oldestWaitingAt: null, draftsExpiringSoon: 0, mailboxes: [],
  lever: { interestedNotInLever: 0, addedToday: 0, addedThisWeek: 0 },
  series: today.series.map((d) => ({ ...d, received: 0, sent: 0 })),
};

const browser = await chromium.launch();
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    for (const variant of width === 1440 ? ['full', 'empty'] : ['full']) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await ctx.route('**/api/**', (route) => {
        const path = new URL(route.request().url()).pathname;
        let body = respond(path);
        if (variant === 'empty') {
          if (path === '/api/today') body = { success: true, data: EMPTY };
          if (path === '/api/mailboxes' || path === '/api/internal/sync-health') body = { success: true, data: [] };
        }
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await ctx.addInitScript(([t, u]) => {
        localStorage.setItem('theme', t);
        localStorage.setItem('auth_token', 'fake');
        localStorage.setItem('auth_user', JSON.stringify(u));
      }, [theme, user]);
      const page = await ctx.newPage();
      await page.goto(`${base}/today`);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${outDir}/today-${variant}-${width}-${theme}.png`, fullPage: true });
      await ctx.close();
    }
  }
}
await browser.close();
console.log('done', fs.readdirSync(outDir).length, 'files');
