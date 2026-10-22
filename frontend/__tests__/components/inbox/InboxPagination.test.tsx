// U1b item 1: the list pages through nextCursor (50/page in prod) — load more
// on scroll / button, ↓ past the end, and group-by-role across every page.
import { http, HttpResponse } from 'msw';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { installInbox, item, server } from './fixtures';
import { renderInbox, search } from './renderInbox';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.sessionStorage.clear();
});
afterAll(() => server.close());

const FIVE = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => item(id, 'interested'));
const rows = () => within(screen.getByRole('list', { name: 'Interested replies' })).getAllByRole('button');

describe('inbox pagination', () => {
  it('shows the first page, then appends the next on "Load more"', async () => {
    installInbox(FIVE, {}, { pageSize: 2 });
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    expect(rows()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: /Dee Fixture/ });
    expect(rows()).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: /Eli Mock/ });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an item that slid across a page boundary only once', async () => {
    installInbox(FIVE);
    server.use(
      http.get('*/api/inbox', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        const counts = { needs_review: 0, interested: 3, not_interested: 0, snoozed: 0, sent_today: 0 };
        const items = cursor ? [FIVE[1], FIVE[2]] : [FIVE[0], FIVE[1]];
        return HttpResponse.json({ success: true, data: { items, counts, roleCounts: [], nextCursor: cursor ? null : 'p2' } });
      })
    );
    const user = userEvent.setup();
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Ada Example/ });
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: /Cy Placeholder/ });
    expect(screen.getAllByRole('button', { name: /Ben Sample/ })).toHaveLength(1);
  });

  it('↓ past the last loaded reply fetches the next page and opens it', async () => {
    installInbox(FIVE, {}, { pageSize: 2 });
    renderInbox('/inbox?view=interested&item=d2');
    await screen.findByRole('region', { name: 'Reply to Ben Sample' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    expect(await screen.findByRole('region', { name: 'Reply to Cy Placeholder' })).toBeInTheDocument();
    expect(search().get('item')).toBe('d3');
  });

  it('group by role loads every page so a role only on a later page gets its section', async () => {
    const items = FIVE.map((it, i) =>
      i === 4 ? { ...it, candidate: { ...it.candidate!, role: 'Designer' } } : it
    );
    installInbox(items, {}, { pageSize: 2 });
    renderInbox('/inbox?view=interested&group=role');
    expect(await screen.findByRole('heading', { name: /Designer/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eli Mock/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Example|Sample|Placeholder|Fixture|Mock/ })).toHaveLength(5);
  });

});

describe('virtualized long views', () => {
  // jsdom has no layout: give the scroller and rows a height so the
  // virtualizer computes a real window (it reads offsetHeight).
  const LAYOUT = { offsetHeight: HTMLElement.prototype, clientHeight: Element.prototype, scrollHeight: Element.prototype };
  const saved = Object.entries(LAYOUT).map(([k, proto]) => [k, proto, Object.getOwnPropertyDescriptor(proto, k)] as const);
  const topDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  beforeEach(() => {
    const height = (el: Element) => (el.hasAttribute('data-index') ? 84 : 600);
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: Element) { return height(this); } });
    Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get(this: Element) { return height(this); } });
    Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get: () => 100_000 });
    // …and scrolling, which jsdom doesn't implement on elements.
    const tops = new WeakMap<Element, number>();
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, v: number) {
        tops.set(this, v);
      },
    });
    Element.prototype.scrollTo = function (this: Element, opts?: ScrollToOptions | number) {
      this.scrollTop = typeof opts === 'object' ? (opts.top ?? 0) : 0;
      this.dispatchEvent(new Event('scroll'));
    } as Element['scrollTo'];
  });
  afterEach(() => {
    for (const [k, proto, d] of saved) {
      if (d) Object.defineProperty(proto, k, d);
      else delete (proto as unknown as Record<string, unknown>)[k];
    }
    delete (Element.prototype as Partial<Element>).scrollTo;
    if (topDesc) Object.defineProperty(Element.prototype, 'scrollTop', topDesc);
  });

  it('virtualizes a long view: only a window of rows is in the DOM, each with its position', async () => {
    const many = Array.from({ length: 150 }, (_, i) => item(`v${i}`, 'interested'));
    installInbox(many);
    renderInbox('/inbox?view=interested');
    await screen.findByRole('button', { name: /Person v0\b/ });
    const list = screen.getByRole('list', { name: 'Interested replies' });
    const shown = within(list).getAllByRole('listitem');
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(150);
    expect(shown[0]).toHaveAttribute('aria-setsize', '150');
    expect(shown[0]).toHaveAttribute('aria-posinset', '1');
  });

  it('↓ through a virtualized view keeps the focused row rendered', async () => {
    const many = Array.from({ length: 150 }, (_, i) => item(`v${i}`, 'interested'));
    installInbox(many);
    renderInbox('/inbox?view=interested&item=v40');
    await screen.findByRole('region', { name: 'Reply to Person v40' });
    fireEvent.keyDown(document.body, { key: 'ArrowDown' });
    await screen.findByRole('region', { name: 'Reply to Person v41' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Person v41\b/ })).toHaveAttribute('aria-current', 'true'));
  });
});
