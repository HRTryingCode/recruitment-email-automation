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
// signature — authenticated in-handler by Lever's HMAC signature (webhooks-lever.ts)
// cron     — authenticated in-handler by CRON_SECRET (internal-cron.ts)
// oauth    — authenticated by the one-time OAuth state row (app.ts callback)
// auth     — requireAuth (any allowed @archive.com user)
// admin    — requireAuth + requireAdmin
type Guard = 'public' | 'pubsub' | 'signature' | 'cron' | 'oauth' | 'auth' | 'admin';

const MANIFEST: Record<string, Guard> = {
  'GET /api/health/': 'public',
  // B1 uptime probe: unauthenticated, returns issue counts only (no ids/addresses).
  'GET /api/health/deep': 'public',
  'POST /api/auth/google': 'public',
  'GET /api/auth/me': 'auth',
  'POST /api/webhooks/gmail': 'pubsub',
  // H2: Lever webhooks; 503 unless LEVER_WEBHOOK_SIGNATURE_TOKENS is set.
  'POST /api/webhooks/lever': 'signature',
  'GET /api/internal/cron/renew-watches': 'cron',
  'GET /api/internal/cron/reconcile': 'cron',
  'GET /api/internal/cron/purge-orphan-bodies': 'cron',
  'GET /api/internal/cron/watchdog': 'cron',
  'GET /api/internal/cron/sweep-stuck-messages': 'cron',
  'GET /api/internal/cron/systemlog-retention': 'cron',
  'GET /api/internal/cron/coverage-summary': 'cron',
  'GET /api/internal/cron/lever-sync': 'cron',
  'GET /api/internal/cron/lever-sync-new': 'cron',
  'GET /api/mailboxes/gmail/callback': 'oauth',
  // F3: Gem (GeMCP) OAuth callback, bound to the user by the one-time gem- state.
  'GET /api/integrations/gem/callback': 'oauth',

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
  // B7 dashboard counts: aggregate numbers only, same audience as the list.
  'GET /api/candidates/counts': 'auth',
  'GET /api/candidates/:id': 'auth',
  'PATCH /api/candidates/:id': 'auth',
  'POST /api/candidates/:id/ignore': 'auth',
  'POST /api/candidates/:id/unignore': 'auth',
  'POST /api/candidates/backfill-roles': 'admin',
  'POST /api/candidates/:id/lever/refresh': 'auth',
  // F3 Add to Lever: create is also gated by LEVER_CREATE_ENABLED in-handler.
  'GET /api/candidates/:id/lever/prefill': 'auth',
  // H5: Gem half of the Add to Lever prefill (cached on the candidate).
  'GET /api/candidates/:id/lever/prefill/gem': 'auth',
  'POST /api/candidates/:id/lever': 'auth',

  'GET /api/emails/threads': 'auth',
  'GET /api/emails/threads/:id/messages': 'auth',
  'POST /api/emails/threads/:id/draft': 'auth',

  'GET /api/drafts/': 'auth',
  'GET /api/drafts/cc-options': 'auth',
  'GET /api/drafts/:id': 'auth',
  'PATCH /api/drafts/:id': 'auth',
  'POST /api/drafts/regenerate-pending': 'admin',
  'POST /api/drafts/:id/regenerate': 'auth',
  'POST /api/drafts/:id/dictate': 'auth',
  'POST /api/drafts/:id/approve': 'auth',
  'POST /api/drafts/:id/discard': 'auth',
  'POST /api/drafts/:id/send': 'auth',
  // U0 inbox actions; the editing lock (423) is enforced in-handler.
  'POST /api/drafts/:id/undo-send': 'auth',
  'POST /api/drafts/:id/dismiss': 'auth',
  'POST /api/drafts/:id/snooze': 'auth',
  'POST /api/drafts/:id/unsnooze': 'auth',
  'POST /api/drafts/:id/presence': 'auth',
  'DELETE /api/drafts/:id/presence': 'auth',
  'POST /api/drafts/batch-send': 'auth',
  // U0 inbox queue.
  'GET /api/inbox/': 'auth',
  // U0 saved views: team-shared ones are admin-only, checked in-handler.
  'GET /api/views/': 'auth',
  'POST /api/views/': 'auth',
  'PATCH /api/views/:id': 'auth',
  'DELETE /api/views/:id': 'auth',

  'GET /api/internal/sync-health': 'auth',

  // F1 global lookup: "do we know this email?" — metadata only.
  'GET /api/lookup/': 'auth',
  'GET /api/lookup/lever-prefill': 'auth',
  'GET /api/lookup/lever-prefill/gem': 'auth',
  'POST /api/lookup/lever': 'auth',

  // F3: Lever reference data + the caller's own Gem connection.
  'GET /api/lever/postings': 'auth',
  'GET /api/lever/me': 'auth',
  'GET /api/integrations/gem/connect': 'auth',
  'GET /api/integrations/gem/status': 'auth',
  'DELETE /api/integrations/gem': 'auth',

  // B3 sender coverage: summary for any user; expected-sender registry is admin-managed.
  'GET /api/coverage/': 'auth',
  'GET /api/coverage/expected-senders': 'admin',
  'POST /api/coverage/expected-senders': 'admin',
  'PATCH /api/coverage/expected-senders/:id': 'admin',
  'DELETE /api/coverage/expected-senders/:id': 'admin',
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
