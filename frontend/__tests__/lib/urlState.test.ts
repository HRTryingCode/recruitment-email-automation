import { viewHref, VIEW_PARAMS } from '../../src/lib/urlState';

describe('viewHref', () => {
  it('keeps the global mailbox filter and drops every view-scoped param', () => {
    const cur = new URLSearchParams('mailboxId=mb1&filter=AWAITING_REPLY&q=bob&draftId=d1&candidateId=c1&sort=name&dir=asc&status=SENT');
    expect(viewHref('/candidates', cur)).toBe('/candidates?mailboxId=mb1');
  });

  it('adds extra params and skips empty ones', () => {
    expect(viewHref('/inbox', new URLSearchParams(), { draftId: 'd1', q: undefined, filter: '' })).toBe('/inbox?draftId=d1');
  });

  it('returns a bare path with no params', () => {
    expect(viewHref('/today', new URLSearchParams('q=x'))).toBe('/today');
  });

  it('lists the view-scoped params', () => {
    expect(VIEW_PARAMS).toEqual(expect.arrayContaining(['filter', 'q', 'draftId', 'candidateId', 'sort', 'dir', 'status', 'lever', 'page']));
  });
});
