# Testing

Backend tests use **Vitest** + **supertest**. The frontend is currently covered
by manual smoke testing only.

## Running tests

```bash
cd backend
npm test                     # runs the full suite once (vitest run)
npm run test:watch           # watches src/ + __tests__/ for changes
npm run test:coverage        # one-shot run + V8 coverage report
npm run typecheck            # tsc on src/ + tsc on tsconfig.test.json
```

Tests do not require a running Postgres — the modules that touch the DB are
either mocked or exercised against a thin in-process fake. They do not require
network access; outbound calls (Anthropic, Gmail) are stubbed.

## Test layout

```
backend/
├── src/
│   ├── lib/crypto.ts
│   ├── services/gmail.service.ts
│   └── …
├── __tests__/
│   ├── lib/crypto.test.ts
│   ├── services/gmail.service.test.ts
│   └── …
├── vitest.config.ts
├── tsconfig.test.json
└── tsconfig.json
```

The `__tests__/` tree mirrors `src/` one-for-one. A test for
`src/services/foo.ts` lives at `__tests__/services/foo.test.ts`. Keep this
convention — it makes it trivial to find tests for a module and vice versa.

`tsconfig.test.json` widens the includes so Vitest can compile both `src/**`
and `__tests__/**` under stricter rules than the production build (e.g.
`vitest/globals`).

## Writing a new test — worked example

Suppose you're adding a test for the safe-stringify behavior in
`services/monitoring.service.ts` (added in commit `99c268a`). The function
should not throw when `details` contains a circular reference.

1. Create `backend/__tests__/services/monitoring.service.test.ts`.

2. Mock the Prisma client so the test doesn't need a DB:

   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   const systemLogCreate = vi.fn();

   vi.mock('../../src/db/client', () => ({
     prisma: { systemLog: { create: systemLogCreate } },
   }));

   import { logEvent } from '../../src/services/monitoring.service';

   beforeEach(() => systemLogCreate.mockReset());
   ```

3. Write the assertion. The goal is behavioral, not structural — exercise
   `logEvent` the way the rest of the codebase does and check that:

   ```ts
   describe('logEvent', () => {
     it('stringifies a circular details payload without throwing', async () => {
       const circular: Record<string, unknown> = { a: 1 };
       circular.self = circular;

       await expect(
         logEvent('test.event', circular, 'INFO')
       ).resolves.not.toThrow();

       expect(systemLogCreate).toHaveBeenCalledOnce();
       const arg = systemLogCreate.mock.calls[0][0];
       expect(arg.data.event).toBe('test.event');
       expect(typeof arg.data.details).toBe('string');
       expect(arg.data.details).toContain('[Circular]');
     });
   });
   ```

4. Run `npm test` — it should pass. Run `npm run test:coverage` and check
   that `services/monitoring.service.ts` coverage improved.

A few things this example illustrates that you'll want for almost every
backend test:

- **Mock the boundary, not the unit.** We mocked `prisma`, not `logEvent`'s
  internals. That's why this test still catches a regression if someone changes
  the call signature.
- **Assert on observable behavior** (didn't throw, called create, payload
  looks right) rather than re-implementing the function.
- **Reset mocks between tests** with `beforeEach`.

For HTTP routes, prefer `supertest` against the Express app from `src/app.ts`
with a mocked Prisma — that lets you exercise the middleware + router + error
handler in one shot. There aren't route-level tests yet; the existing files
under `__tests__/lib/`, `__tests__/middleware/`, and `__tests__/services/` are
the closest patterns to crib from in the meantime.

## CI

`.github/workflows/test.yml` runs on every PR against the production branch.
It installs the workspace, generates the Prisma client, then runs:

```bash
cd backend && npm run typecheck && npm test
```

A red check blocks merge. The job is fast (~30–60s) because no external
service is contacted.

## Coverage

Goals, not enforced gates:

- **`lib/`** (crypto, oauthState): aim for **>90%**. These are small,
  deterministic, and security-relevant — any new branch deserves a test.
- **`services/`** (gmail, claude, auth, monitoring): aim for **>80%**.
  Most of the production risk lives here.
- **`middleware/`**: aim for **>80%**. Easy to test, easy to break.
- **`routes/`**: less critical at the unit level — they're thin wrappers around
  services. We rely on supertest integration tests for the happy/error paths,
  not per-line coverage.

If you're adding a new feature, the rule of thumb: a `services/` change without
a corresponding test in `__tests__/services/` should get a review comment.

## End-to-end

There is currently **no automated E2E suite.** The manual smoke test before a
significant deploy is:

1. Sign in to the production dashboard with an `@archive.com` Google account.
2. Connect a test Gmail mailbox via the OAuth flow.
3. From a non-Archive Gmail, send a "candidate" reply to a thread the test
   mailbox initiated.
4. Within ~30 seconds, confirm a draft appears in **Email Drafts** with a
   plausible classification and reply body.
5. Click **Regenerate** to confirm the regeneration endpoint works.
6. Click **Approve & Send** — verify the recipient gets the email and that
   `sofia@archive.com` (or whatever `DRAFT_CC_EMAIL` is) is on the CC line.
7. Hit `GET /api/internal/sync-health` and confirm the mailbox row shows a
   recent `lastSyncedMessageAt`.

If any step fails, do not promote the deploy — roll back per
[OPERATIONS.md](OPERATIONS.md#rolling-back) and investigate.
