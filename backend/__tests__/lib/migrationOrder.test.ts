import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Prisma applies migration folders in LEXICAL order, so "10_x" would run
// before "1_add_user". Folder names must be a single digit plus an optional
// lowercase letter ("9_", "9b_", "9c_") so lexical order == intended order.

const dir = path.resolve(__dirname, '../../prisma/migrations');
const names = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('prisma migration folder naming', () => {
  it('uses <digit>[letter]_ prefixes only', () => {
    const bad = names.filter((n) => !/^\d[a-z]?_/.test(n));
    expect(bad).toEqual([]);
  });

  it('sorts lexically in the same order as (number, letter)', () => {
    const key = (n: string) => {
      const m = /^(\d+)([a-z]?)_/.exec(n)!;
      return [Number(m[1]), m[2]] as const;
    };
    const lexical = [...names].sort();
    const intended = [...names].sort((a, b) => {
      const [na, la] = key(a);
      const [nb, lb] = key(b);
      return na - nb || la.localeCompare(lb);
    });
    expect(lexical).toEqual(intended);
  });
});
