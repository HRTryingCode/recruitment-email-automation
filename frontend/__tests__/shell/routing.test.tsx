import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import * as api from '../../src/lib/api';
import * as toast from '../../src/lib/toast';

vi.mock('../../src/lib/api', () => ({
  getMe: vi.fn(),
  fetchMailboxes: vi.fn(),
  fetchInbox: vi.fn(),
  fetchSyncHealth: vi.fn(),
  fetchToday: vi.fn(),
  fetchLookup: vi.fn(),
  fetchCandidates: vi.fn(),
  addGmailMailbox: vi.fn(),
}));
vi.mock('../../src/lib/toast', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/toast')>()),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// The screens themselves are R2–R4's; stub them so this tests the shell.
vi.mock('../../src/pages/InboxPage', async () => {
  const { useMailboxFilter } = await import('../../src/lib/urlState');
  return {
    default: () => {
      const [mailboxId] = useMailboxFilter();
      return <div data-testid="screen">inbox:{mailboxId ?? 'all'}</div>;
    },
  };
});
vi.mock('../../src/components/CandidateTable', () => ({
  default: ({ mailboxId }: { mailboxId?: string }) => <div data-testid="screen">candidates:{mailboxId ?? 'all'}</div>,
}));
vi.mock('../../src/pages/settings/MailboxesSettings', () => ({ default: () => <div data-testid="screen">settings:mailboxes</div> }));
vi.mock('../../src/pages/settings/IntegrationsSettings', () => ({ default: () => <div data-testid="screen">settings:integrations</div> }));
vi.mock('../../src/pages/settings/TeamSettings', () => ({ default: () => <div data-testid="screen">settings:team</div> }));

const MAILBOXES = [
  { id: 'mb1', provider: 'GMAIL', emailAddress: 'sofia@archive.com', isActive: true, createdAt: '', updatedAt: '' },
  { id: 'mb2', provider: 'GMAIL', emailAddress: 'paul@archive.com', isActive: true, createdAt: '', updatedAt: '' },
] as api.Mailbox[];

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const loc = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('auth_token', 'fake');
  vi.mocked(api.getMe).mockResolvedValue({ id: 'u1', email: 'rae@archive.com', name: 'Rae Recruiter' });
  vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: MAILBOXES });
  vi.mocked(api.fetchInbox).mockResolvedValue({
    success: true,
    data: { items: [], counts: { needs_review: 4, interested: 2, not_interested: 1, snoozed: 0, sent_today: 0 }, nextCursor: null },
  });
  vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.fetchToday).mockResolvedValue({
    success: true,
    data: {
      generatedAt: '',
      views: { needs_review: 1, interested: 2, not_interested: 0 },
      sentToday: 0,
      oldestWaitingAt: null,
      draftsExpiringSoon: 0,
      mailboxes: [],
      lever: { interestedNotInLever: 0, addedToday: 0, addedThisWeek: 0 },
      series: [],
    },
  });
});

describe('routes', () => {
  it('/ redirects to /inbox', async () => {
    renderAt('/');
    expect(await screen.findByText('inbox:all')).toBeInTheDocument();
    expect(loc()).toBe('/inbox');
  });

  it.each([
    ['/?tab=dashboard', '/today', "Replies waiting, what went out, and what's next for Lever."],
    ['/?tab=drafts&draftId=d1', '/inbox?draftId=d1', 'inbox:all'],
    ['/?tab=candidates&filter=AWAITING_REPLY&q=bob', '/candidates?filter=AWAITING_REPLY&q=bob', 'candidates:all'],
  ])('legacy %s → %s', async (from, to, screenText) => {
    renderAt(from);
    expect(await screen.findByText(screenText)).toBeInTheDocument();
    expect(loc()).toBe(to);
  });

  it('/settings → /settings/mailboxes, with section links', async () => {
    renderAt('/settings');
    expect(await screen.findByText('settings:mailboxes')).toBeInTheDocument();
    expect(loc()).toBe('/settings/mailboxes');
    await userEvent.click(screen.getByRole('link', { name: /integrations/i }));
    expect(await screen.findByText('settings:integrations')).toBeInTheDocument();
  });

  it('unknown paths render Not found', async () => {
    renderAt('/nope');
    expect(await screen.findByText(/page not found/i)).toBeInTheDocument();
  });

  it('signed-out users go to /login', async () => {
    window.localStorage.removeItem('auth_token');
    renderAt('/candidates');
    await waitFor(() => expect(loc()).toBe('/login'));
  });
});

describe('URL state across the shell', () => {
  it('switching views keeps the mailbox filter and clears view params (filter/q bug)', async () => {
    renderAt('/candidates?mailboxId=mb2&filter=AWAITING_REPLY&q=bob');
    expect(await screen.findByText('candidates:mb2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /^inbox/i }));
    expect(await screen.findByText('inbox:mb2')).toBeInTheDocument();
    expect(loc()).toBe('/inbox?mailboxId=mb2');
  });

  it('Today → a waiting count opens that Inbox view with only the mailbox filter', async () => {
    renderAt('/today?mailboxId=mb1&q=stale');
    const strip = await screen.findByRole('region', { name: 'Today' });
    await userEvent.click(within(strip).getByRole('link', { name: /^interested/i }));
    expect(await screen.findByText('inbox:mb1')).toBeInTheDocument();
    expect(loc()).toBe('/inbox?mailboxId=mb1&view=interested');
  });

  it('the mailbox filter writes ?mailboxId= and the screen follows', async () => {
    const user = userEvent.setup();
    renderAt('/inbox');
    await screen.findByText('inbox:all');
    await user.click(await screen.findByRole('combobox', { name: /mailbox filter/i }));
    await user.click(await screen.findByRole('option', { name: 'paul@archive.com' }));
    expect(await screen.findByText('inbox:mb2')).toBeInTheDocument();
    expect(loc()).toBe('/inbox?mailboxId=mb2');
  });

  it('shows the waiting count (from the inbox counts, not pending drafts) on the Inbox nav item', async () => {
    renderAt('/inbox');
    expect(await screen.findByLabelText('7 waiting')).toBeInTheDocument();
  });

  it('a Gmail OAuth callback on / toasts once and strips the params', async () => {
    renderAt('/?mailbox=connected');
    await screen.findByText('inbox:all');
    await waitFor(() => expect(loc()).toBe('/inbox'));
    expect(toast.toastSuccess).toHaveBeenCalledTimes(1);
    expect(toast.toastSuccess).toHaveBeenCalledWith('Mailbox connected', expect.any(String));
  });


});
