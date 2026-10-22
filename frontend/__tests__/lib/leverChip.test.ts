import { describe, expect, it } from 'vitest';
import { leverChip } from '../../src/lib/leverChip';

describe('leverChip — one label set for the table badge and the side panel', () => {
  it.each([
    ['ACTIVE', 'In Lever', 'info'],
    ['HIRED', 'Hired', 'success'],
    ['ARCHIVED', 'Archived', 'secondary'],
    ['NOT_FOUND', 'Not in Lever', 'outline'],
    ['ERROR', 'Lever unknown', 'warning'],
    [null, 'Checking Lever…', 'outline'],
    [undefined, 'Checking Lever…', 'outline'],
  ] as const)('%s → "%s" (%s)', (state, text, variant) => {
    expect(leverChip({ leverState: state })).toMatchObject({ text, variant, state: state ?? 'CHECKING' });
  });

  it('details: job · stage while active, the reason once archived, the job once hired', () => {
    const job = { leverPostingTitle: 'Founding Engineer', leverStage: 'Phone Screen', leverArchivedReason: 'Withdrew' };
    expect(leverChip({ ...job, leverState: 'ACTIVE' }).detail).toBe('Founding Engineer · Phone Screen');
    expect(leverChip({ ...job, leverState: 'ARCHIVED' }).detail).toBe('Withdrew');
    expect(leverChip({ ...job, leverState: 'HIRED' }).detail).toBe('Founding Engineer');
    expect(leverChip({ ...job, leverState: 'NOT_FOUND' }).detail).toBeNull();
    expect(leverChip({ leverState: 'ACTIVE', leverStage: 'New lead' }).detail).toBe('New lead');
  });
});
