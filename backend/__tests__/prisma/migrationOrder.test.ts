import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'fs';
import path from 'path';

// Prisma applies migration folders in lexical (byte) order, so "10_x" would
// run before "1_add_user". Folder names must sort lexically in the same
// order as their numeric prefix: use 9b_, 9c_ … rather than 10_, 11_.
const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations');
const NAME = /^(\d+)([a-z]*)_[a-z0-9_]+$/;

function intendedOrder(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const [, an, as] = a.match(NAME)!;
    const [, bn, bs] = b.match(NAME)!;
    return Number(an) - Number(bn) || (as < bs ? -1 : as > bs ? 1 : 0);
  });
}

function lexicalOrder(names: string[]): string[] {
  // JS default sort compares UTF-16 code units: same as LC_ALL=C for ASCII.
  return [...names].sort();
}

describe('prisma migration folder order', () => {
  const dirs = readdirSync(MIGRATIONS_DIR).filter((d) =>
    statSync(path.join(MIGRATIONS_DIR, d)).isDirectory()
  );

  it('every folder is named <number><optional letters>_<name>', () => {
    for (const d of dirs) expect(d).toMatch(NAME);
  });

  it('lexical order (what Prisma applies) matches numeric order', () => {
    expect(lexicalOrder(dirs)).toEqual(intendedOrder(dirs));
  });

  it('the check catches a two-digit prefix', () => {
    const bad = ['0_init', '1_add_user', '9_x', '10_y'];
    expect(lexicalOrder(bad)).not.toEqual(intendedOrder(bad));
  });
});
