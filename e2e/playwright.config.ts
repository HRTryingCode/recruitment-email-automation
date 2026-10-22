import { defineConfig, devices } from '@playwright/test';

// By default the suite runs against a local stack that Playwright boots
// itself: the backend API on :3001 and `vite preview` of the built SPA on
// :4173, which proxies /api to the backend (see frontend/vite.config.ts).
// That way CI tests the code in the PR, not whatever is already in prod.
//
// To smoke-test a deployed environment instead (a Vercel preview, or prod
// after a deploy), set E2E_BASE_URL — no local servers are started then.
//
// The local backend needs a reachable Postgres with migrations applied
// (POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING). CI provides one via a
// service container; locally, point those vars at a throwaway database.
const externalBaseUrl = process.env.E2E_BASE_URL;
const LOCAL_BASE_URL = 'http://localhost:4173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: externalBaseUrl || LOCAL_BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: 'npx tsx src/index.ts',
          cwd: '../backend',
          url: 'http://localhost:3001/api/health',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: 'pipe',
          stderr: 'pipe',
        },
        {
          command: 'npx vite preview --port 4173 --strictPort',
          cwd: '../frontend',
          url: LOCAL_BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
