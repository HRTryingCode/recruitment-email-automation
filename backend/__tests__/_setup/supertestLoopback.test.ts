// Regression guard for the H6 route-test flake (inbox/mailboxes/drafts tests
// randomly getting an empty 404 or "socket hang up").
//
// supertest calls `server.listen(0)` with no host, so Node binds the IPv6
// wildcard `::`, then supertest dials `127.0.0.1:<port>`. macOS will assign
// `::` a port that another process (Loom, Superhuman, a dev server…) already
// holds on IPv4 loopback, and the request lands in that process instead of
// the app under test. setup.ts makes supertest dial the loopback of the
// family the server actually bound.
import http from 'node:http';
import net from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';

const listen = (server: net.Server, port: number, host?: string) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (host) server.listen(port, host, () => resolve());
    else server.listen(port, () => resolve());
  });

describe('supertest dials the loopback of the family the server bound', () => {
  const servers: net.Server[] = [];
  afterEach(() => {
    servers.splice(0).forEach((s) => s.close());
  });
  const track = <T extends net.Server>(s: T) => (servers.push(s), s);

  it('requests to an ephemeral app server reach that app', async () => {
    const res = await request((_req: http.IncomingMessage, res: http.ServerResponse) => res.end('mine')).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('mine');
  });

  it('a dual-stack `::` server is dialled on [::1], an IPv4 one on 127.0.0.1', async () => {
    const server = track(http.createServer());
    await listen(server, 0);
    const { family, port } = server.address() as net.AddressInfo;
    const url = request(server).get('/x').url;
    expect(url).toBe(family === 'IPv6' ? `http://[::1]:${port}/x` : `http://127.0.0.1:${port}/x`);
  });

  it('a foreign IPv4-loopback listener on the same port cannot intercept the request', async (ctx) => {
    const foreign = track(http.createServer((_req, res) => res.writeHead(404).end()));
    await listen(foreign, 0, '127.0.0.1');
    const { port } = foreign.address() as net.AddressInfo;
    const ours = track(http.createServer((_req, res) => res.end('mine')));
    // macOS lets `::` share a port with a 127.0.0.1 listener (the flake);
    // Linux refuses with EADDRINUSE, so there is nothing to collide with.
    try {
      await listen(ours, port);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') return ctx.skip();
      throw err;
    }
    const res = await request(ours).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('mine');
  });
});
