import { test, expect } from '@playwright/test';

test('login page renders the Google sign-in container', async ({ page }) => {
  await page.goto('/login');
  // The Login page renders the GIS button into an empty div via an effect.
  // Once the GIS script loads, Google injects an iframe into that container.
  // We accept either:
  //   - an explicit [data-testid="google-signin"] (if it exists), or
  //   - the visible "Welcome back" copy + the Google iframe injected by GIS.
  const explicitTestId = page.locator('[data-testid="google-signin"]');
  if (await explicitTestId.count()) {
    await expect(explicitTestId.first()).toBeVisible();
    return;
  }
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  // Either the GIS iframe is mounted or the "Loading Google sign-in…" hint is shown.
  const gisIframe = page.locator('iframe[src*="accounts.google.com"]').first();
  const loadingHint = page.getByText('Loading Google sign-in', { exact: false });
  await expect(gisIframe.or(loadingHint)).toBeVisible({ timeout: 10_000 });
});

test('/nonexistent renders the 404 component', async ({ page }) => {
  await page.goto('/nonexistent');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByText('Error 404')).toBeVisible();
});

test('fresh session has no stored auth token', async ({ page }) => {
  await page.goto('/login');
  // App auth is stored in localStorage under `auth_token` / `auth_user`.
  const { token, user } = await page.evaluate(() => {
    try {
      return {
        token: window.localStorage.getItem('auth_token'),
        user: window.localStorage.getItem('auth_user'),
      };
    } catch {
      return { token: null, user: null };
    }
  });
  expect(token).toBeNull();
  expect(user).toBeNull();
  // No app-owned auth cookies. Google Identity Services may set its own
  // `g_state` cookie when the GIS script loads — that's third-party state, not
  // ours, so we only assert nothing named like our auth tokens leaks in.
  const cookies = await page.context().cookies();
  const appAuthCookies = cookies.filter((c) =>
    /auth|session|token|jwt/i.test(c.name),
  );
  expect(appAuthCookies).toEqual([]);
});
