// Helpers for integration tests that exercise the Express app via supertest.
//
// `app.ts` wires its routes from static imports, so there's no runtime DI to
// inject mocks through. Tests instead mock the prisma client (and any other
// side-effecting service) via `vi.mock(...)` at the top of the test file,
// then call `loadApp()` to get the configured Express instance.
import { issueToken } from '../../src/services/auth.service';

export async function loadApp() {
  const mod = await import('../../src/app');
  return mod.default;
}

/** Returns `Bearer <jwt>` for a user id. Pairs with the real requireAuth middleware. */
export function bearer(userId: string): string {
  return `Bearer ${issueToken(userId)}`;
}
