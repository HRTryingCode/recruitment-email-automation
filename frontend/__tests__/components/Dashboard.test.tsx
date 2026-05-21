import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../../src/components/Dashboard';
import { TooltipProvider } from '../../src/components/ui/Tooltip';
import type {
  Candidate,
  EmailDraft,
  Mailbox,
  MailboxSyncHealth,
} from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchDrafts: vi.fn(),
  fetchMailboxes: vi.fn(),
  fetchSyncHealth: vi.fn(),
  approveDraft: vi.fn(),
}));

const fetchCandidatesMock = vi.mocked(api.fetchCandidates);
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
    watchExpiry: '2026-06-01T00:00:00.000Z',
    watchExpiresInHours: 240,
    lastSyncedMessageAt: '2026-05-20T11:00:00.000Z',
    lastReconciliationAt: '2026-05-20T10:00:00.000Z',
    lastReconciliationFoundMissing: 0,
    messagesLast24h: 12,
    pendingDrafts: 2,
    candidatesNeedsReview: 1,
    webhookErrorsLast24h: 0,
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

  it('renders the three action pills with counts derived from fixture data', async () => {
    renderDashboard();

    // Wait for the queries to resolve — Ada Lovelace only renders inside the
    // quick-triage panel once the drafts query has fired.
    await screen.findByText('Ada Lovelace');

    const draftsPill = screen.getByTestId('action-pill-drafts');
    await waitFor(() => {
      expect(within(draftsPill).getByText('2')).toBeInTheDocument();
    });
    expect(within(draftsPill).getByText(/drafts pending/i)).toBeInTheDocument();

    // 1 candidate is AWAITING_REPLY in the fixture.
    const awaitingPill = screen.getByTestId('action-pill-awaiting');
    expect(within(awaitingPill).getByText('1')).toBeInTheDocument();
    expect(within(awaitingPill).getByText(/awaiting reply/i)).toBeInTheDocument();

    // 1 NEEDS_REVIEW candidate (Grace Hopper)
    const reviewPill = screen.getByTestId('action-pill-review');
    expect(within(reviewPill).getByText('1')).toBeInTheDocument();
    expect(within(reviewPill).getByText(/needs review/i)).toBeInTheDocument();
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

  it('mailbox health renders as a collapsed accordion by default', async () => {
    renderDashboard();

    await screen.findByText(/mailbox health/i);

    // The accordion is closed by default — the detail table should not be
    // mounted, so the column header is not visible.
    expect(screen.queryByText(/watch expires/i)).not.toBeInTheDocument();

    // Toggling expands it
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: /mailbox health/i });
    await user.click(trigger);

    expect(
      await screen.findByText(/watch expires/i)
    ).toBeInTheDocument();
  });
});
