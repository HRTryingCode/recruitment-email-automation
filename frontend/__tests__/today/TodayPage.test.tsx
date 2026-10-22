import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TodayPage from '../../src/pages/TodayPage';
import type { MailboxSyncHealth, TodaySummary } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchToday: vi.fn(),
  fetchMailboxes: vi.fn(),
  fetchSyncHealth: vi.fn(),
}));

const NOW = Date.now();
const DAY = 24 * 3600_000;

const days = Array.from({ length: 14 }, (_, i) => ({
  day: new Date(NOW - (13 - i) * DAY).toISOString().slice(0, 10),
  received: i === 13 ? 4 : 1,
  sent: i === 13 ? 2 : 0,
}));

const SUMMARY: TodaySummary = {
  generatedAt: new Date(NOW).toISOString(),
  views: { needs_review: 3, interested: 5, not_interested: 2 },
  sentToday: 6,
  oldestWaitingAt: new Date(NOW - (2 * DAY + 4 * 3600_000)).toISOString(),
  draftsExpiringSoon: 1,
  mailboxes: [
    { mailboxId: 'mb1', waiting: 7, sentToday: 4, lastReceivedAt: new Date(NOW - 30 * 60_000).toISOString() },
    { mailboxId: 'mb2', waiting: 3, sentToday: 2, lastReceivedAt: null },
  ],
  lever: { interestedNotInLever: 4, addedToday: 1, addedThisWeek: 3 },
  series: days,
};

const EMPTY: TodaySummary = {
  ...SUMMARY,
  views: { needs_review: 0, interested: 0, not_interested: 0 },
  sentToday: 0,
  oldestWaitingAt: null,
  draftsExpiringSoon: 0,
  mailboxes: [],
  lever: { interestedNotInLever: 0, addedToday: 0, addedThisWeek: 0 },
  series: days.map((d) => ({ ...d, received: 0, sent: 0 })),
};

const HEALTHY = {
  mailboxId: 'mb1', emailAddress: 'sofia@archive.com', authStatus: 'OK', watchExpiresInHours: 120,
  consecutiveReconcileFailures: 0, lastReconciliationAt: new Date(NOW).toISOString(),
} as MailboxSyncHealth;
const REVOKED = { ...HEALTHY, mailboxId: 'mb2', emailAddress: 'paul@archive.com', authStatus: 'NEEDS_REAUTH' } as MailboxSyncHealth;

function renderPage(entry = '/today') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <TodayPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchToday).mockResolvedValue({ success: true, data: SUMMARY });
  vi.mocked(api.fetchMailboxes).mockResolvedValue({
    success: true,
    data: [
      { id: 'mb1', emailAddress: 'sofia@archive.com' },
      { id: 'mb2', emailAddress: 'paul@archive.com' },
    ] as api.Mailbox[],
  });
  vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [HEALTHY, REVOKED] });
});

describe('Today page', () => {
  it('links each waiting count into its Inbox view, keeping the mailbox filter', async () => {
    renderPage('/today?mailboxId=mb1&q=stale');
    const strip = await screen.findByRole('region', { name: 'Today' });
    expect(within(strip).getByRole('link', { name: /needs review\s*3/i })).toHaveAttribute('href', '/inbox?mailboxId=mb1&view=needs_review');
    expect(within(strip).getByRole('link', { name: /^interested\s*5/i })).toHaveAttribute('href', '/inbox?mailboxId=mb1&view=interested');
    expect(within(strip).getByRole('link', { name: /not interested\s*2/i })).toHaveAttribute('href', '/inbox?mailboxId=mb1&view=not_interested');
    expect(within(strip).getByRole('link', { name: /sent today\s*6/i })).toHaveAttribute('href', '/inbox?mailboxId=mb1&view=sent_today');
    expect(api.fetchToday).toHaveBeenCalledWith({ mailboxId: 'mb1' });
  });

  it('shows the oldest waiting age with an SLA hint past 2 days, and drafts expiring soon', async () => {
    renderPage();
    const strip = await screen.findByRole('region', { name: 'Today' });
    expect(within(strip).getByText('2d 4h')).toBeInTheDocument();
    expect(within(strip).getByText(/over 2 days/i)).toBeInTheDocument();
    expect(within(strip).getByText(/expiring in 24h/i).closest('a')).toHaveAttribute('href', '/inbox');
  });

  it('per-mailbox table: waiting, sent today, last received, health dot linking to Settings only when unhealthy', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: /mailboxes/i });
    const sofia = within(table).getByRole('row', { name: /sofia@archive\.com/ });
    expect(within(sofia).getByText('7')).toBeInTheDocument();
    expect(within(sofia).getByText('4')).toBeInTheDocument();
    expect(within(sofia).getByText('30m ago')).toBeInTheDocument();
    expect(await within(sofia).findByText('Healthy')).toBeInTheDocument();
    expect(within(sofia).queryByRole('link')).not.toBeInTheDocument();
    const paul = within(table).getByRole('row', { name: /paul@archive\.com/ });
    expect(within(paul).getByText('—')).toBeInTheDocument();
    expect(await within(paul).findByRole('link', { name: /reconnect required/i })).toHaveAttribute('href', '/settings/mailboxes');
  });

  it('Lever snapshot links Interested-not-in-Lever to the Candidates view', async () => {
    renderPage('/today?mailboxId=mb2');
    const lever = await screen.findByRole('region', { name: 'Lever' });
    expect(await within(lever).findByRole('link', { name: /interested, not in lever\s*4/i })).toHaveAttribute(
      'href',
      '/candidates?mailboxId=mb2&status=INTERESTED&lever=NOT_IN'
    );
    expect(within(lever).getByText('Added today').nextSibling).toHaveTextContent('1');
    expect(within(lever).getByText('Added this week').nextSibling).toHaveTextContent('3');
  });

  it('14-day chart exposes its data as a table', async () => {
    renderPage();
    const chart = await screen.findByRole('region', { name: /last 14 days/i });
    const rows = await within(chart).findAllByRole('row');
    expect(rows).toHaveLength(15); // header + 14 days
    expect(within(chart).getByText(/17 received · 2 sent/)).toBeInTheDocument();
  });

  it('renders empty states on a fresh install', async () => {
    vi.mocked(api.fetchToday).mockResolvedValue({ success: true, data: EMPTY });
    vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: [] });
    vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [] });
    renderPage();
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    expect(screen.getByText('No mailboxes connected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /connect a mailbox/i })).toHaveAttribute('href', '/settings/mailboxes');
    expect(screen.getByText(/no activity in the last 14 days/i)).toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.fetchToday).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getAllByTestId('today-skeleton').length).toBeGreaterThan(0);
  });

  it('shows an error state with retry when the summary fails', async () => {
    vi.mocked(api.fetchToday).mockRejectedValueOnce(new Error('500'));
    renderPage();
    expect(await screen.findByText(/couldn't load today's summary/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(api.fetchToday).toHaveBeenCalledTimes(2);
  });
});

