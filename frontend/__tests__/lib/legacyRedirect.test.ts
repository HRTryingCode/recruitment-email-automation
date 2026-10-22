import { legacyRedirect } from '../../src/lib/legacyRedirect';

describe('legacyRedirect (pre-R1 ?tab= deep links)', () => {
  it.each([
    ['', '/inbox'],
    ['?tab=dashboard', '/today'],
    ['?tab=drafts', '/inbox'],
    ['?tab=drafts&draftId=d1', '/inbox?draftId=d1'],
    ['?tab=drafts&candidateId=c1', '/inbox?candidateId=c1'],
    ['?tab=candidates', '/candidates'],
    ['?tab=candidates&filter=AWAITING_REPLY', '/candidates?filter=AWAITING_REPLY'],
    ['?tab=candidates&q=bob%40x.com', '/candidates?q=bob%40x.com'],
    ['?tab=bogus', '/inbox'],
    // OAuth callbacks land on "/" — keep their params for the shell toasts.
    ['?mailbox=connected', '/inbox?mailbox=connected'],
    ['?mailbox=error&reason=nope', '/inbox?mailbox=error&reason=nope'],
    ['?gem=connected', '/inbox?gem=connected'],
    ['?tab=candidates&mailboxId=mb1', '/candidates?mailboxId=mb1'],
  ])('/%s → %s', (search, to) => {
    expect(legacyRedirect(search)).toBe(to);
  });

  it('drops view params that do not belong to the target view', () => {
    expect(legacyRedirect('?tab=dashboard&draftId=d1&q=x')).toBe('/today');
  });
});
