// Shared factory for building a deep-mocked Prisma client.
//
// Each route test file does:
//
//   vi.mock('../../src/db/client', () => {
//     const prisma = buildPrismaMock();
//     return { prisma, default: prisma };
//   });
//
// The factory body executes lazily — when `src/db/client` is first imported
// transitively through `app.ts`. By that point the test file's top-of-file
// imports (including this helper) have completed, so `buildPrismaMock` is
// defined. After mocking, tests pull the same instance back via:
//
//   import { prisma } from '../../src/db/client';
//   const mockPrisma = prisma as unknown as MockPrisma;
//
// and program per-test return values with `mockResolvedValueOnce(...)`.
import { vi, type Mock } from 'vitest';

type MockedMethods<T extends string> = Record<T, Mock>;

export interface MockPrisma {
  user: MockedMethods<'findUnique' | 'findMany' | 'create' | 'update'>;
  mailbox: MockedMethods<'findUnique' | 'findMany' | 'update' | 'upsert'>;
  candidate: MockedMethods<
    'findUnique' | 'findMany' | 'count' | 'create' | 'update' | 'updateMany'
  >;
  emailDraft: MockedMethods<
    'findUnique' | 'findMany' | 'count' | 'create' | 'update' | 'updateMany'
  >;
  emailThread: MockedMethods<'findUnique' | 'findMany' | 'update'>;
  emailMessage: MockedMethods<'findUnique' | 'findFirst' | 'findMany' | 'count'>;
  systemLog: MockedMethods<'create' | 'findMany'>;
  $transaction: Mock;
  $queryRaw: Mock;
}

function methods<T extends string>(...names: T[]): MockedMethods<T> {
  const out = {} as MockedMethods<T>;
  for (const n of names) out[n] = vi.fn();
  return out;
}

export function buildPrismaMock(): MockPrisma {
  const mock: MockPrisma = {
    user: methods('findUnique', 'findMany', 'create', 'update'),
    mailbox: methods('findUnique', 'findMany', 'update', 'upsert'),
    candidate: methods(
      'findUnique',
      'findMany',
      'count',
      'create',
      'update',
      'updateMany'
    ),
    emailDraft: methods(
      'findUnique',
      'findMany',
      'count',
      'create',
      'update',
      'updateMany'
    ),
    emailThread: methods('findUnique', 'findMany', 'update'),
    emailMessage: methods('findUnique', 'findFirst', 'findMany', 'count'),
    systemLog: methods('create', 'findMany'),
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  };

  // monitoring.service.logEvent calls systemLog.create on every route action.
  // Resolve by default so we don't have to program it per-test.
  mock.systemLog.create.mockResolvedValue({});

  // requireAdmin (added in Phase AO) calls user.findUnique to verify the role
  // of the authenticated user. Default to an admin so existing integration
  // tests for admin-only endpoints (mailbox resync, refresh-all-profiles,
  // regenerate-pending, etc.) don't all have to opt in. Tests that exercise
  // the 401 / 403 paths can still override with `mockResolvedValueOnce(null)`
  // or `mockResolvedValueOnce({ role: 'recruiter' })`, since once-mocks take
  // precedence over the default.
  mock.user.findUnique.mockResolvedValue({
    id: 'test-user-1',
    role: 'admin',
  });

  return mock;
}

export function resetPrismaMock(p: MockPrisma): void {
  for (const model of Object.values(p)) {
    if (typeof model === 'function' && 'mockReset' in model) {
      (model as Mock).mockReset();
      continue;
    }
    if (model && typeof model === 'object') {
      for (const fn of Object.values(model as Record<string, unknown>)) {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as Mock).mockReset();
        }
      }
    }
  }
  // Re-seed safe defaults that beforeEach assumes.
  p.systemLog.create.mockResolvedValue({});
  p.user.findUnique.mockResolvedValue({
    id: 'test-user-1',
    role: 'admin',
  });
}
