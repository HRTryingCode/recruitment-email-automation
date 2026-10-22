// Audit B6 / L5: every route in the app must have an explicitly declared
// guard. Adding a route without adding it here fails the build, and a route
// whose declared guard doesn't match its middleware chain fails too.
import { describe, it, expect, vi } from 'vitest';
import { buildPrismaMock } from '../_setup/mockPrisma';
import { loadApp } from '../_setup/testApp';
import { listRoutes } from '../_setup/routeInventory';

vi.mock('../../src/db/client', () => {
  const prisma = buildPrismaMock();
  return { prisma, default: prisma };
});

// public   — no auth at all (health, sign-in)
// pubsub   — authenticated in-handler by verifyPubSubJwt (webhooks.ts)
// cron     — authenticated in-handler by CRON_SECRET (internal-cron.ts)
// oauth    — authenticated by the one-time OAuth state row (app.ts callback)
// auth     — requireAuth (any allowed @archive.com user)
// admin    — requireAuth + requireAdmin
type Guard = 'public' | 'pubsub' | 'cron' | 'oauth' | 'auth' | 'admin';

const MANIFEST: Record<string, Guard> = {
  'GET /api/health/': 'public',
  'POST /api/auth/google': 'public',
  'GET /api/auth/me': 'auth',
  'POST /api/webhooks/gmail': 'pubsub',
  'GET /api/internal/cron/renew-watches': 'cron',
  'GET /api/internal/cron/reconcile': 'cron',
  'GET /api/mailboxes/gmail/callback': 'oauth',

  'GET /api/mailboxes/': 'auth',
  'POST /api/mailboxes/gmail/auth': 'auth',
  'POST /api/mailboxes/:id/resync': 'admin',
  'POST /api/mailboxes/:id/reclassify': 'auth',
  'POST /api/mailboxes/workspace/connect': 'admin',
  'POST /api/mailboxes/refresh-all-profiles': 'admin',
  'POST /api/mailboxes/:id/refresh-profile': 'auth',
  'GET /api/mailboxes/:id/signature': 'auth',
  'DELETE /api/mailboxes/:id': 'admin',

  'GET /api/candidates/': 'auth',
  'GET /api/candidates/:id': 'auth',
  'PATCH /api/candidates/:id': 'auth',
  'POST /api/candidates/:id/ignore': 'auth',
  'POST /api/candidates/:id/unignore': 'auth',
  'POST /api/candidates/backfill-roles': 'admin',

  'GET /api/emails/threads': 'auth',
  'GET /api/emails/threads/:id/messages': 'auth',
  'POST /api/emails/threads/:id/draft': 'auth',

  'GET /api/drafts/': 'auth',
  'GET /api/drafts/:id': 'auth',
  'PATCH /api/drafts/:id': 'auth',
  'POST /api/drafts/regenerate-pending': 'admin',
  'POST /api/drafts/:id/regenerate': 'auth',
  'POST /api/drafts/:id/dictate': 'auth',
  'POST /api/drafts/:id/approve': 'auth',
  'POST /api/drafts/:id/discard': 'auth',
  'POST /api/drafts/:id/send': 'auth',

  'GET /api/internal/sync-health': 'auth',
  'GET /api/internal/debug/mailbox': 'admin',
  'GET /api/internal/debug/candidate': 'admin',
  'GET /api/internal/debug/drafts': 'admin',
};

function expectedChain(g: Guard): string[] {
  if (g === 'admin') return ['requireAuth', 'requireAdmin'];
  if (g === 'auth') return ['requireAuth'];
  return [];
}

describe('route guard inventory', () => {
  it('every registered route is declared in the manifest, and vice versa', async () => {
    const app = await loadApp();
    const actual = listRoutes(app).map((r) => `${r.method} ${r.path}`).sort();
    expect(actual).toEqual(Object.keys(MANIFEST).sort());
  });

  it('every route runs exactly its declared guard chain', async () => {
    const app = await loadApp();
    const mismatches = listRoutes(app)
      .map((r) => {
        const key = `${r.method} ${r.path}`;
        const want = expectedChain(MANIFEST[key]);
        return { key, want, got: r.guards };
      })
      .filter(({ want, got }) => JSON.stringify(want) !== JSON.stringify(got));
    expect(mismatches).toEqual([]);
  });

  it('the removed one-off repair routes stay removed', async () => {
    const app = await loadApp();
    const paths = listRoutes(app).map((r) => r.path);
    for (const gone of ['fix-replied-at', 'restore-discarded-drafts', 'purge-no-role-candidates']) {
      expect(paths.some((p) => p.includes(gone))).toBe(false);
    }
  });
});
