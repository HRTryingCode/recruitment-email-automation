// Test-wide setup: ensure env vars our modules read at import time have safe
// defaults so individual tests don't have to remember.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret';
// Default key (base64 of 32 bytes). Individual crypto tests may override.
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-anthropic-key';
// Route integration tests instantiate google-auth-library.OAuth2Client with
// config.gmail.clientId; an empty value flips /api/auth/google to a 500
// "Google sign-in is not configured" branch before our mocks see the request.
process.env.GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID ?? 'test-gmail-client-id';
process.env.GMAIL_CLIENT_SECRET =
  process.env.GMAIL_CLIENT_SECRET ?? 'test-gmail-client-secret';

// supertest listens with `server.listen(0)` (no host → IPv6 wildcard `::`)
// but always dials `127.0.0.1:<port>`. macOS will give `::` a port that
// another process already holds on IPv4 loopback (Loom, Superhuman, a dev
// server…), so the request silently lands there and the test sees an empty
// 404 or "socket hang up" — the H6 route-test flake. Dial the loopback of the
// family the server actually bound; the kernel picked that port as free in
// that family. Regression test: __tests__/_setup/supertestLoopback.test.ts.
import { createRequire } from 'node:module';
import type { AddressInfo, Server } from 'node:net';

type SupertestTest = { serverAddress(app: Server, path: string): string };
const SupertestTest: { prototype: SupertestTest } = createRequire(__filename)('supertest/lib/test.js');
const originalServerAddress = SupertestTest.prototype.serverAddress;
SupertestTest.prototype.serverAddress = function (this: SupertestTest, app: Server, path: string) {
  const url = originalServerAddress.call(this, app, path);
  const addr = app.address() as AddressInfo | null;
  return addr?.family === 'IPv6' ? url.replace('://127.0.0.1:', '://[::1]:') : url;
};
