// Audit B6 / L7: the SPA's static CSP lives in vercel.json and allows the
// inline theme-bootstrap <script> in index.html by hash. If that script is
// edited without updating the hash, the browser blocks it — this test fails
// first instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(__dirname, '..', '..');
const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8')) as {
  headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const html = readFileSync(resolve(root, 'frontend', 'index.html'), 'utf8');

const spaRule = vercel.headers.find((h) => h.source === '/((?!api/).*)');
const header = (key: string) => spaRule?.headers.find((h) => h.key === key)?.value;

describe('SPA security headers (vercel.json)', () => {
  it('declares CSP, frame-ancestors, X-Frame-Options and nosniff for non-API routes', () => {
    const csp = header('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });

  it('script-src allows every inline <script> in index.html by its exact sha256 hash', () => {
    const csp = header('Content-Security-Policy') ?? '';
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);
    for (const body of inline) {
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
      expect(scriptSrc).toContain(hash);
    }
  });

  it('allows every external script/stylesheet origin referenced by index.html', () => {
    const csp = header('Content-Security-Policy') ?? '';
    const srcs = [...html.matchAll(/<script[^>]*\ssrc="(https:[^"]+)"/g)].map((m) => m[1]);
    for (const src of srcs) {
      expect(csp.includes(src) || csp.includes(new URL(src).origin)).toBe(true);
    }
    const sheets = [...html.matchAll(/rel="stylesheet"[\s\S]*?href="(https:[^"]+)"/g)].map((m) => m[1]);
    for (const href of sheets) {
      expect(csp).toContain(new URL(href).origin);
    }
  });
});
