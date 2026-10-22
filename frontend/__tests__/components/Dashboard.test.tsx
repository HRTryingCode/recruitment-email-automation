import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../../src/components/Dashboard';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import type {
  Candidate,
  EmailDraft,
  Mailbox,
  MailboxSyncHealth,
} from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchCandidateCounts: vi.fn(),
  fetchDrafts: vi.fn(),
  fetchMailboxes: vi.fn(),
  fetchSyncHealth: vi.fn(),
  // Sender-coverage panel (B3); resolves undefined → panel stays hidden.
  fetchSenderCoverage: vi.fn(),
  approveDraft: vi.fn(),
  addGmailMailbox: vi.fn(),
  // H1 auto-refresh of never-checked Lever rows; never settles here.
  refreshCandidateLever: vi.fn(() => new Promise(() => {})),
}));

const fetchCandidatesMock = vi.mocked(api.fetchCandidates);
const fetchCandidateCountsMock = vi.mocked(api.fetchCandidateCounts);
const fetchDraftsMock = vi.mocked(api.fetchDrafts);
const fetchMailboxesMock = vi.mocked(api.fetchMailboxes);
const fetchSyncHealthMock = vi.mocked(api.fetchSyncHealth);
const approveDraftMock = vi.mocked(api.approveDraft);

const MAILBOX: Mailbox = {
  id: 'mb-1',
  provider: 'GMAIL',
  emailAddress: 'sofia@archive.com',
  isActive: true,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-20T00:00:00.000Z',
};

const CANDIDATES: Candidate[] = [
  {
    id: 'cand-interested',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    status: 'INTERESTED',
    role: 'Senior Engineer',
    mailboxId: MAILBOX.id,
    replyStatus: 'AWAITING_REPLY',
    threads: [
      {
        id: 'thread-1',
        mailboxId: MAILBOX.id,
        externalThreadId: 'ext-1',
        subject: 'Re: Senior Engineer role',
        lastMessageAt: '2026-05-20T10:00:00.000Z',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    ],
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
  },
  {
    id: 'cand-review',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    status: 'NEEDS_REVIEW',
    mailboxId: MAILBOX.id,
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-19T11:00:00.000Z',
  },
  {
    id: 'cand-neutral',
    name: 'Alan Turing',
    email: 'alan@example.com',
    status: 'NEUTRAL',
    mailboxId: MAILBOX.id,
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-19T11:00:00.000Z',
  },
];

const DRAFTS: EmailDraft[] = [
  {
    id: 'draft-1',
    threadId: 'thread-1',
    thread: {
      id: 'thread-1',
      mailboxId: MAILBOX.id,
      externalThreadId: 'ext-1',
      subject: 'Re: Senior Engineer role',
      lastMessageAt: '2026-05-20T10:00:00.000Z',
      createdAt: '2026-05-19T10:00:00.000Z',
      mailbox: {
        id: MAILBOX.id,
        emailAddress: MAILBOX.emailAddress,
        provider: 'GMAIL',
      },
      candidate: {
        id: CANDIDATES[0].id,
        name: CANDIDATES[0].name,
        email: CANDIDATES[0].email,
        status: 'INTERESTED',
      },
    },
    subject: 'Re: Senior Engineer role',
    bodyText: 'Hi Ada,\n\nThanks for reaching out — happy to chat next week.',
    classification: 'INTERESTED',
    confidence: 0.92,
    status: 'PENDING',
    createdAt: '2026-05-20T11:00:00.000Z',
    updatedAt: '2026-05-20T11:00:00.000Z',
  },
  {
    id: 'draft-2',
    threadId: 'thread-2',
    thread: {
      id: 'thread-2',
      mailboxId: MAILBOX.id,
      externalThreadId: 'ext-2',
      subject: 'Re: Staff Engineer',
      lastMessageAt: '2026-05-20T09:00:00.000Z',
      createdAt: '2026-05-19T09:00:00.000Z',
      mailbox: {
        id: MAILBOX.id,
        emailAddress: MAILBOX.emailAddress,
        provider: 'GMAIL',
      },
      candidate: {
        id: 'cand-other',
        name: 'Marie Curie',
        email: 'marie@example.com',
        status: 'INTERESTED',
      },
    },
    subject: 'Re: Staff Engineer',
    bodyText: 'Hi Marie,\n\nThanks for getting back to me.',
    classification: 'INTERESTED',
    confidence: 0.88,
    status: 'PENDING',
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
  },
];

const SYNC_HEALTH: MailboxSyncHealth[] = [
  {
    mailboxId: MAILBOX.id,
    emailAddress: MAILBOX.emailAddress,
    displayName: null,
    isActive: true,
    authStatus: 'OK',
    lastAuthError: null,
    lastAuthErrorAt: null,
    watchExpiry: '2026-06-01T00:00:00.000Z',
    watchExpiresInHours: 240,
    lastSyncedMessageAt: '2026-05-20T11:00:00.000Z',
    // Relative to now: a reconcile older than 3h marks the mailbox as not syncing.
    lastReconciliationAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    lastReconciliationFoundMissing: 0,
    lastReconcileError: null,
    consecutiveReconcileFailures: 0,
    messagesLast24h: 12,
    totalMessages: 100,
    totalCandidates: 3,
    pendingDrafts: 2,
    candidatesNeedsReview: 1,
    webhookErrorsLast24h: 0,
    lastWebhookError: null,
    error: false,
  },
];

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderDashboard(
  props: React.ComponentProps<typeof Dashboard> = {
    onRefetchMailboxes: () => {},
  }
) {
  const client = createClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <Dashboard {...props} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<Dashboard />', () => {
  beforeEach(() => {
    fetchCandidatesMock.mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 1000 },
    });
    // Server-side totals, deliberately larger than any client sample (M18).
    fetchCandidateCountsMock.mockResolvedValue({
      success: true,
      data: {
        candidates: 592,
        awaitingReply: 324,
        needsReview: 75,
        pendingDrafts: 2,
        byMailbox: [{ mailboxId: MAILBOX.id, candidates: 592, awaitingReply: 324, needsReview: 75, pendingDrafts: 2 }],
      },
    });
    fetchDraftsMock.mockResolvedValue({
      success: true,
      data: DRAFTS,
      meta: { total: DRAFTS.length, page: 1, limit: 1000 },
    });
    fetchMailboxesMock.mockResolvedValue({
      success: true,
      data: [MAILBOX],
    });
    fetchSyncHealthMock.mockResolvedValue({
      success: true,
      data: SYNC_HEALTH,
    });
    approveDraftMock.mockResolvedValue({ success: true, message: 'ok' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the pipeline overview heading', async () => {
    renderDashboard();
    expect(
      await screen.findByRole('heading', { name: /pipeline overview/i })
    ).toBeInTheDocument();
  });

  it('renders the three action pills with server-side counts (M18)', async () => {
    renderDashboard();

    // Wait for the queries to resolve — Ada Lovelace only renders inside the
    // quick-triage panel once the drafts query has fired.
    await screen.findByText('Ada Lovelace');

    const draftsPill = screen.getByTestId('action-pill-drafts');
    await waitFor(() => {
      expect(within(draftsPill).getByText('2')).toBeInTheDocument();
    });
    expect(within(draftsPill).getByText(/drafts pending/i)).toBeInTheDocument();

    const awaitingPill = screen.getByTestId('action-pill-awaiting');
    await waitFor(() => {
      expect(within(awaitingPill).getByText('324')).toBeInTheDocument();
    });
    expect(within(awaitingPill).getByText(/awaiting reply/i)).toBeInTheDocument();
    // M19: awaiting means the candidate wrote and we haven't answered.
    expect(within(awaitingPill).getByText(/candidate replied — you haven't/i)).toBeInTheDocument();

    const reviewPill = screen.getByTestId('action-pill-review');
    expect(within(reviewPill).getByText('75')).toBeInTheDocument();
    expect(within(reviewPill).getByText(/needs review/i)).toBeInTheDocument();

    // No 500-row candidate download; drafts fetch only the triage top 5.
    expect(fetchCandidatesMock).not.toHaveBeenCalled();
    expect(fetchDraftsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', limit: 5 }));
  });

  it('shows the server awaiting count as-is (no-role exclusion is done in SQL, B7)', async () => {
    fetchCandidateCountsMock.mockResolvedValue({
      success: true,
      data: { candidates: 3, awaitingReply: 1, needsReview: 0, pendingDrafts: 2, byMailbox: [] },
    });
    renderDashboard();
    const awaitingPill = await screen.findByTestId('action-pill-awaiting');
    await waitFor(() => {
      expect(within(awaitingPill).getByText('1')).toBeInTheDocument();
    });
    expect(fetchCandidatesMock).not.toHaveBeenCalled();
  });

  it('the quick triage panel shows pending drafts and approves on one click', async () => {
    const user = userEvent.setup();
    renderDashboard();

    // Pending drafts appear inside the quick-triage panel with candidate names
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Marie Curie')).toBeInTheDocument();

    const approveBtns = screen.getAllByRole('button', {
      name: /approve draft for/i,
    });
    await user.click(approveBtns[0]);

    await waitFor(() => {
      expect(approveDraftMock).toHaveBeenCalled();
    });
    // First call's first arg should be a known draft id from the fixture
    expect(['draft-1', 'draft-2']).toContain(
      approveDraftMock.mock.calls[0][0]
    );
  });

  it('account pipelines section renders one condensed row per mailbox (no stacked bar)', async () => {
    renderDashboard();

    // The condensed row shows the mailbox address as monospace text
    expect(
      await screen.findByText('sofia@archive.com')
    ).toBeInTheDocument();

    // The pre-rewrite version rendered a "candidates tracked" label inside
    // each card; the condensed row no longer uses that phrasing.
    expect(screen.queryByText(/candidates tracked/i)).not.toBeInTheDocument();

    // The condensed row shows a "N pending drafts" hint.
    expect(
      screen.getByText(/pending draft/i)
    ).toBeInTheDocument();
  });

  it('clicking the drafts action pill switches to the drafts tab', async () => {
    const onSwitchToDrafts = vi.fn();
    const user = userEvent.setup();
    renderDashboard({
      onRefetchMailboxes: () => {},
      onSwitchToDrafts,
    });

    const pill = await screen.findByTestId('action-pill-drafts');
    await user.click(pill);

    expect(onSwitchToDrafts).toHaveBeenCalledTimes(1);
  });

  it('clicking the awaiting-reply pill switches to the candidates tab with AWAITING_REPLY filter', async () => {
    const onSwitchToCandidates = vi.fn();
    const user = userEvent.setup();
    renderDashboard({
      onRefetchMailboxes: () => {},
      onSwitchToCandidates,
    });

    const pill = await screen.findByTestId('action-pill-awaiting');
    await user.click(pill);

    expect(onSwitchToCandidates).toHaveBeenCalledTimes(1);
    expect(onSwitchToCandidates).toHaveBeenCalledWith('AWAITING_REPLY');
  });

  it('renders the "All caught up" empty state when no pending drafts exist', async () => {
    fetchDraftsMock.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 1000 },
    });

    renderDashboard();
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });

  it('mailbox admin lives in Settings now: no health table or debug lookup on Today (R1)', async () => {
    renderDashboard();
    await screen.findAllByText('sofia@archive.com');
    expect(screen.queryByText(/watch expires/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/find candidate by email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resync all/i })).not.toBeInTheDocument();
  });

  it('surfaces a revoked mailbox: rose pill and reconnect on the account row', async () => {
    fetchSyncHealthMock.mockResolvedValue({
      success: true,
      data: [
        {
          ...SYNC_HEALTH[0],
          authStatus: 'NEEDS_REAUTH',
          lastAuthError: 'invalid_grant',
          lastAuthErrorAt: '2026-05-25T17:51:00.000Z',
          watchExpiresInHours: -3500,
        },
      ],
    });
    renderDashboard();

    expect(await screen.findByText('1 mailbox: reconnect required')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /reconnect sofia@archive\.com/i })).toBeInTheDocument();
  });

  it('shows no reconnect action when healthy', async () => {
    renderDashboard();
    await screen.findAllByText('sofia@archive.com');
    expect(screen.queryByRole('button', { name: /reconnect sofia/i })).not.toBeInTheDocument();
  });
});
