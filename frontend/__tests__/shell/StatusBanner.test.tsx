import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import StatusBanner from '../../src/components/shell/StatusBanner';
import { bannerIssues } from '../../src/lib/statusBanner';
import type { MailboxSyncHealth } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchSyncHealth: vi.fn(),
  addGmailMailbox: vi.fn(),
}));

const fetchSyncHealthMock = vi.mocked(api.fetchSyncHealth);
const addGmailMailboxMock = vi.mocked(api.addGmailMailbox);

function row(over: Partial<MailboxSyncHealth>): MailboxSyncHealth {
  return {
    mailboxId: 'mb1', emailAddress: 'sofia@archive.com', displayName: null, isActive: true,
    authStatus: 'OK', lastAuthError: null, lastAuthErrorAt: null, watchExpiry: null, watchExpiresInHours: 100,
    lastSyncedMessageAt: null, lastReconciliationAt: new Date().toISOString(), lastReconciliationFoundMissing: 0,
    lastReconcileError: null, consecutiveReconcileFailures: 0, messagesLast24h: 1, totalMessages: 1,
    totalCandidates: 1, pendingDrafts: 0, candidatesNeedsReview: 0, webhookErrorsLast24h: 0,
    lastWebhookError: null, error: false, ...over,
  } as MailboxSyncHealth;
}

const AARON = row({ mailboxId: 'mb-a', emailAddress: 'aaronrampersad@archive.com', authStatus: 'NEEDS_REAUTH' });
const PAUL = row({ mailboxId: 'mb-p', emailAddress: 'paul@archive.com', watchExpiresInHours: -3 });

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <StatusBanner />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  window.sessionStorage.clear();
});

describe('bannerIssues', () => {
  it('returns NEEDS_REAUTH and expired-watch mailboxes only', () => {
    expect(bannerIssues([row({}), AARON, PAUL, row({ consecutiveReconcileFailures: 5 })]).map((i) => i.mailboxId)).toEqual(['mb-a', 'mb-p']);
  });
});

describe('<StatusBanner />', () => {
  it('renders nothing when every mailbox is fine', async () => {
    fetchSyncHealthMock.mockResolvedValue({ success: true, data: [row({})] });
    const { container } = renderBanner();
    await waitFor(() => expect(fetchSyncHealthMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when sync-health fails (e.g. 403 for non-admins)', async () => {
    fetchSyncHealthMock.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    const { container } = renderBanner();
    await waitFor(() => expect(fetchSyncHealthMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('one issue: names the mailbox and Reconnect starts the OAuth flow', async () => {
    fetchSyncHealthMock.mockResolvedValue({ success: true, data: [row({}), AARON] });
    addGmailMailboxMock.mockResolvedValue({ success: true, data: { authUrl: 'https://accounts.google.com/o/x' } });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    renderBanner();
    expect(await screen.findByText('aaronrampersad@ needs reconnecting')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^reconnect/i }));
    await waitFor(() => expect(addGmailMailboxMock).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/x');
  });

  it('several issues collapse into one banner with a count and a details link', async () => {
    fetchSyncHealthMock.mockResolvedValue({ success: true, data: [AARON, PAUL] });
    renderBanner();
    expect(await screen.findByText('2 mailboxes need reconnecting')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByText(/aaronrampersad@, paul@/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /details/i })).toHaveAttribute('href', '/settings/mailboxes');
  });

  it('dismiss hides it for the session; a new issue brings it back', async () => {
    fetchSyncHealthMock.mockResolvedValue({ success: true, data: [AARON] });
    const first = renderBanner();
    await screen.findByText('aaronrampersad@ needs reconnecting');
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    first.unmount();

    renderBanner();
    await waitFor(() => expect(fetchSyncHealthMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fetchSyncHealthMock.mockResolvedValue({ success: true, data: [AARON, PAUL] });
    renderBanner();
    expect(await screen.findByText('2 mailboxes need reconnecting')).toBeInTheDocument();
  });
});
