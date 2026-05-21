import { test, expect } from '@playwright/test';

test('GET /api/health returns 200 with status "healthy"', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  // The API wraps responses as { success: true, data: { status, ... } }
  // Accept both wrapped and unwrapped shapes so the assertion stays useful if
  // the endpoint is ever simplified.
  const status = body?.data?.status ?? body?.status;
  expect(status).toBe('healthy');
});

test('GET / serves the SPA HTML', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toContain('<title>Archive Recruiting AI</title>');
});
