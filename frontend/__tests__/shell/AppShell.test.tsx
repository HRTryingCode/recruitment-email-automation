import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  getMe: vi.fn(),
  fetchMailboxes: vi.fn(),
  fetchDrafts: vi.fn(),
  fetchInbox: vi.fn(),
  fetchSyncHealth: vi.fn(),
  fetchToday: vi.fn(),
  addGmailMailbox: vi.fn(),
}));

// A stand-in Inbox that reads the inbox queue with the real page's paged
// list hook, so the test can prove the shell adds no extra request.
vi.mock('../../src/pages/InboxPage', async () => {
  const { useInboxList } = await import('../../src/hooks/useInboxList');
  const { useInboxUrlState } = await import('../../src/hooks/useInboxUrlState');
  return {
    default: () => {
      const { view, mailboxId, sort, roles, grouped } = useInboxUrlState();
      const list = useInboxList({ view, mailboxId, sort, roles, grouped });
      return <div data-testid="screen">inbox:{list.ready ? 'loaded' : 'loading'}</div>;
    },
  };
});

vi.mock('../../src/pages/TodayPage', () => ({ default: () => <div data-testid="screen">today</div> }));
vi.mock('../../src/pages/settings/MailboxesSettings', () => ({ default: () => <div data-testid="screen">settings</div> }));

const MAILBOX = { id: 'mb1', provider: 'GMAIL', emailAddress: 'sofia@archive.com', isActive: true, createdAt: '', updatedAt: '' } as api.Mailbox;
const COUNTS = { needs_review: 4, interested: 2, not_interested: 1, snoozed: 9, sent_today: 30 };

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return qc;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('auth_token', 'fake');
  vi.mocked(api.getMe).mockResolvedValue({ id: 'u1', email: 'rae@archive.com', name: 'Rae Recruiter' });
  vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: [MAILBOX] });
  vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.fetchInbox).mockResolvedValue({ success: true, data: { items: [], counts: COUNTS, nextCursor: null } });
  vi.mocked(api.addGmailMailbox).mockResolvedValue({ success: true, data: { authUrl: 'https://accounts.google.com/x' } });
});

describe('first run — no mailboxes connected', () => {
  beforeEach(() => {
    vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: [] });
  });

  it.each(['/inbox', '/today'])('%s shows the Connect a Gmail mailbox card instead of the screen', async (path) => {
    renderAt(path);
    expect(await screen.findByRole('heading', { name: 'Connect a Gmail mailbox' })).toBeInTheDocument();
    expect(screen.queryByTestId('screen')).not.toBeInTheDocument();
    expect(screen.queryByText(/inbox zero/i)).not.toBeInTheDocument();
  });

  it.each([
    ['/inbox', 'inbox', /candidate replies show up here/i],
    ['/today', 'today', /today's summary fills in/i],
  ])('%s explains what the mailbox unlocks there', async (path, context, copy) => {
    renderAt(path);
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(document.querySelector(`[data-context=${context}]`)).not.toBeNull();
  });

  it('the primary button starts the Gmail connect flow', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    renderAt('/inbox');
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Gmail mailbox' }));
    await waitFor(() => expect(api.addGmailMailbox).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/x'));
    vi.unstubAllGlobals();
  });

  it('Settings still renders (that is where mailboxes are managed)', async () => {
    renderAt('/settings/mailboxes');
    expect(await screen.findByTestId('screen')).toHaveTextContent('settings');
  });
});

describe('onboarding card stays away when it should', () => {
  it('not shown when a mailbox is connected', async () => {
    renderAt('/inbox');
    expect(await screen.findByTestId('screen')).toBeInTheDocument();
    expect(screen.queryByText('Connect a Gmail mailbox')).not.toBeInTheDocument();
  });

  it('not shown when the mailboxes request fails', async () => {
    vi.mocked(api.fetchMailboxes).mockRejectedValue(new Error('500'));
    renderAt('/inbox');
    expect(await screen.findByTestId('screen')).toBeInTheDocument();
    expect(screen.queryByText('Connect a Gmail mailbox')).not.toBeInTheDocument();
  });

  it('not shown while mailboxes are still loading', async () => {
    vi.mocked(api.fetchMailboxes).mockReturnValue(new Promise(() => {}));
    renderAt('/inbox');
    expect(await screen.findByTestId('screen')).toBeInTheDocument();
    expect(screen.queryByText('Connect a Gmail mailbox')).not.toBeInTheDocument();
  });
});

describe('Inbox nav badge', () => {
  it('sums needs review + interested + not interested from the inbox counts', async () => {
    renderAt('/today');
    expect(await screen.findByLabelText('7 waiting')).toHaveTextContent('7');
    expect(api.fetchDrafts).not.toHaveBeenCalled();
  });

  it('follows the mailbox filter', async () => {
    renderAt('/today?mailboxId=mb1');
    await screen.findByLabelText('7 waiting');
    expect(api.fetchInbox).toHaveBeenCalledWith({ view: 'needs_review', mailboxId: 'mb1', order: 'newest', role: undefined });
  });

  it('shares the Inbox page query — no extra request, even on another view', async () => {
    renderAt('/inbox?view=interested&sort=oldest&role=SDR');
    expect(await screen.findByLabelText('7 waiting')).toBeInTheDocument();
    await screen.findByText('inbox:loaded');
    expect(api.fetchInbox).toHaveBeenCalledTimes(1);
    expect(api.fetchInbox).toHaveBeenCalledWith({ view: 'interested', mailboxId: undefined, order: 'oldest', role: ['SDR'] });
  });

  it('hides the badge at zero', async () => {
    vi.mocked(api.fetchInbox).mockResolvedValue({
      success: true,
      data: { items: [], counts: { ...COUNTS, needs_review: 0, interested: 0, not_interested: 0 }, nextCursor: null },
    });
    renderAt('/today');
    await waitFor(() => expect(api.fetchInbox).toHaveBeenCalled());
    expect(screen.queryByLabelText(/waiting$/)).not.toBeInTheDocument();
  });
});
