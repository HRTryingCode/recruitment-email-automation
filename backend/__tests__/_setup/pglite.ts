// Real Postgres (PGlite, WASM) with every Prisma migration applied, for
// tests that must exercise SQL the mocked Prisma client can't: raw queries
// and the migrations themselves. No server or network needed.
import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');

export function migrationNames(): string[] {
  // Lexical order = the order Prisma applies them (see migrationOrder.test).
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
    .sort();
}

export async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  for (const name of migrationNames()) {
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
  }
  return db;
}
