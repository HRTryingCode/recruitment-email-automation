import { test, expect } from '@playwright/test';

test('GET /api/mailboxes without Bearer token returns 401', async ({ request }) => {
  const res = await request.get('/api/mailboxes');
  expect(res.status()).toBe(401);
});

test('GET /api/candidates without Bearer token returns 401', async ({ request }) => {
  const res = await request.get('/api/candidates');
  expect(res.status()).toBe(401);
});

test('POST /api/auth/google with empty body returns 400', async ({ request }) => {
  const res = await request.post('/api/auth/google', { data: {} });
  expect(res.status()).toBe(400);
});

test('POST /api/auth/google with garbage idToken returns 401', async ({ request }) => {
  const res = await request.post('/api/auth/google', { data: { idToken: 'garbage' } });
  expect(res.status()).toBe(401);
});
