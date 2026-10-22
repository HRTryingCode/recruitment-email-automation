import { describe, expect, it } from 'vitest';
import { groupByRole, ROLE_UNKNOWN } from '../../src/lib/inbox';
import type { InboxItem } from '../../src/lib/api';

const it_ = (id: string, role: string | null) => ({ id, kind: 'draft', candidate: { role } }) as unknown as InboxItem;

describe('groupByRole', () => {
  it('orders sections by count desc, then name, with Role unknown last; items keep their order', () => {
    const items = [it_('1', 'Designer'), it_('2', null), it_('3', 'Engineer'), it_('4', 'Designer'), it_('5', 'Analyst'), it_('6', 'Engineer'), it_('7', '  ')];
    const groups = groupByRole(items, [
      { role: 'Designer', count: 2 },
      { role: 'Engineer', count: 2 },
      { role: 'Analyst', count: 1 },
      { role: null, count: 9 },
    ]);
    expect(groups.map((g) => [g.key, g.label, g.count])).toEqual([
      ['Designer', 'Designer', 2],
      ['Engineer', 'Engineer', 2],
      ['Analyst', 'Analyst', 1],
      [ROLE_UNKNOWN, 'Role unknown', 9],
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['1', '4']);
    expect(groups[3].items.map((i) => i.id)).toEqual(['2', '7']);
  });

  it('falls back to loaded counts when the server has none for a role', () => {
    const groups = groupByRole([it_('1', 'Zeta'), it_('2', 'Alpha'), it_('3', 'Zeta')], []);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ['Zeta', 2],
      ['Alpha', 1],
    ]);
  });
});
