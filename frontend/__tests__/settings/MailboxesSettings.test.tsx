import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MailboxesSettings from '../../src/pages/settings/MailboxesSettings';
import { mailboxActionError } from '../../src/components/settings/MailboxHealthTable';
import type { MailboxSyncHealth } from '../../src/lib/api';
import * as api from '../../src/lib/api';
import * as toast from '../../src/lib/toast';

vi.mock('../../src/lib/api', () => ({
  fetchMailboxes: vi.fn(),
  fetchSyncHealth: vi.fn(),
  resyncMailbox: vi.fn(),
  reclassifyMailbox: vi.fn(),
  fetchMailboxSignatureHtml: vi.fn(),
  addGmailMailbox: vi.fn(),
  fetchSenderCoverage: vi.fn(),
  fetchExpectedSenders: vi.fn(),
}));
vi.mock('../../src/lib/toast', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/toast')>()),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const ROW: MailboxSyncHealth = {
  mailboxId: 'mb-1', emailAddress: 'sofia@archive.com', displayName: null, isActive: true, authStatus: 'OK',
  lastAuthError: null, lastAuthErrorAt: null, watchExpiry: null, watchExpiresInHours: 120,
  lastSyncedMessageAt: null, lastReconciliationAt: new Date().toISOString(), lastReconciliationFoundMissing: 0,
  lastReconcileError: null, consecutiveReconcileFailures: 0, messagesLast24h: 3, totalMessages: 100,
  totalCandidates: 4, pendingDrafts: 1, candidatesNeedsReview: 0, webhookErrorsLast24h: 0, lastWebhookError: null, error: false,
} as MailboxSyncHealth;
const REVOKED = { ...ROW, mailboxId: 'mb-2', emailAddress: 'aaron@archive.com', authStatus: 'NEEDS_REAUTH', lastAuthError: 'invalid_grant' };

function axiosError(status: number, error?: string) {
  return new AxiosError('Request failed', 'ERR', undefined, undefined, {
    status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data: error ? { error } : {},
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MailboxesSettings />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [ROW, REVOKED as MailboxSyncHealth] });
  vi.mocked(api.fetchSenderCoverage).mockRejectedValue(new Error('hidden'));
});

describe('Settings → Mailboxes', () => {
  it('renders the health table with per-mailbox state and a reconnect action', async () => {
    renderPage();
    expect(await screen.findByText('sofia@archive.com')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /live updates/i })).toBeInTheDocument();
    expect(screen.getByText('1 mailbox: reconnect required')).toBeInTheDocument();
    expect(screen.getByText(/invalid_grant/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect aaron@archive.com' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reconnect sofia@archive.com' })).not.toBeInTheDocument();
  });

  it('the resync spinner follows the real request', async () => {
    let finish!: (v: Awaited<ReturnType<typeof api.resyncMailbox>>) => void;
    vi.mocked(api.resyncMailbox).mockReturnValue(new Promise((r) => (finish = r)));
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Resync sofia@archive.com' });
    await userEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(within(btn).getByRole('status')).toBeInTheDocument();
    expect(btn).toHaveTextContent('Resyncing…');
    finish({ success: true, data: { messagesSeen: 10, messagesStored: 2 } });
    await waitFor(() => expect(btn).toHaveTextContent(/^Resync$/));
    expect(btn).toBeEnabled();
    expect(toast.toastSuccess).toHaveBeenCalledWith('Resync finished', 'sofia@archive.com: 2 stored / 10 seen.');
  });

  it('a failed resync shows the specific reason', async () => {
    vi.mocked(api.resyncMailbox).mockRejectedValue(axiosError(403));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Resync sofia@archive.com' }));
    await waitFor(() => expect(toast.toastError).toHaveBeenCalledWith('Resync failed', 'Only admins can resync mailboxes.'));
  });

  it('re-classify reports what it did', async () => {
    vi.mocked(api.reclassifyMailbox).mockResolvedValue({ success: true, data: { threadsFound: 4, threadsClassified: 3 } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: /re-classify unlinked threads in sofia/i }));
    expect(await screen.findByText('3/4 threads classified')).toBeInTheDocument();
  });

  it('signature preview opens a dialog and explains a missing signature', async () => {
    vi.mocked(api.fetchMailboxSignatureHtml).mockResolvedValue({ signatureHtml: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview signature for sofia@archive.com' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No signature found')).toBeInTheDocument();
    expect(within(dialog).getByText(/gmail\.settings\.basic/)).toBeInTheDocument();
  });

  it('shows an error state when sync-health fails', async () => {
    vi.mocked(api.fetchSyncHealth).mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText(/could not load mailbox health/i, undefined, { timeout: 4000 })).toBeInTheDocument();
  });

  it('the health table has no developer jargon', async () => {
    const FAILING = { ...ROW, mailboxId: 'mb-3', emailAddress: 'paul@archive.com', consecutiveReconcileFailures: 4, lastReconcileError: 'ETIMEDOUT' };
    const EXPIRED = { ...ROW, mailboxId: 'mb-4', emailAddress: 'ann@archive.com', watchExpiresInHours: -5 };
    vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [ROW, FAILING, EXPIRED] as MailboxSyncHealth[] });
    const { container } = renderPage();
    await screen.findByText('paul@archive.com');
    expect(container.textContent).not.toMatch(/reconcil|drift|webhook|watch|vercel/i);
    expect(screen.getByText(/catch-up sync failed 4 times in a row/i)).toBeInTheDocument();
  });

  it('the error state speaks human and offers Retry', async () => {
    vi.mocked(api.fetchSyncHealth).mockRejectedValue(new Error('500'));
    renderPage();
    expect(
      await screen.findByText(
        'Something went wrong loading mailboxes. Try again, or ask an admin to check the server logs.',
        undefined,
        { timeout: 4000 }
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/vercel/i)).not.toBeInTheDocument();
    vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [ROW] });
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('sofia@archive.com')).toBeInTheDocument();
  });

  it('with no mailboxes, the empty state has a Connect Gmail button that starts sign-in', async () => {
    vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [] });
    vi.mocked(api.addGmailMailbox).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(await screen.findByText('Connect a Gmail mailbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    expect(api.addGmailMailbox).toHaveBeenCalledTimes(1);
  });

  it('has no debug "Find candidate by email" box (⌘K replaces it)', async () => {
    renderPage();
    await screen.findByText('sofia@archive.com');
    expect(screen.queryByText(/find candidate by email/i)).not.toBeInTheDocument();
  });
});

describe('mailboxActionError', () => {
  it.each([
    [axiosError(403), 'Only admins can resync mailboxes.'],
    [axiosError(401), 'Your session expired — sign in again.'],
    [axiosError(500, 'invalid_grant: Token has been expired or revoked'), 'Google rejected this mailbox’s login — reconnect it first, then try again.'],
    [axiosError(500, 'Gmail quota exceeded'), 'Gmail quota exceeded'],
  ])('%#', (err, msg) => {
    expect(mailboxActionError(err, 'resync')).toBe(msg);
  });
});
