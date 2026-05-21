import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../../src/components/Dashboard';
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
}));

const fetchCandidatesMock = vi.mocked(api.fetchCandidates);
const fetchDraftsMock = vi.mocked(api.fetchDrafts);
const fetchMailboxesMock = vi.mocked(api.fetchMailboxes);
const fetchSyncHealthMock = vi.mocked(api.fetchSyncHealth);

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
    bodyText: 'Hi Ada,\n\nThanks for reaching out…',
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
    bodyText: 'Hi Marie,\n\nThanks…',
    classification: 'INTERESTED',
    confidence: 0.88,
    status: 'PENDING',
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
  },
];

const SYNC_HEALTH: MailboxSyncHealth[] = [];

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
        <Dashboard {...props} />
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

  it('displays stat counts derived from the fixture data', async () => {
    renderDashboard();

    // Wait for react-query to settle before reading any metric values —
    // otherwise we see skeletons in place of the numbers.
    await screen.findByText('Ada Lovelace');

    function cardFor(label: string): HTMLElement {
      // MetricCard renders <p>{label}</p> followed by <p>{value}</p> + hint
      // inside a min-w-0 wrapper. Scope to that wrapper.
      const labelEl = screen.getByText(label);
      return labelEl.closest('div')! as HTMLElement;
    }

    // 3 candidates total
    const totalCard = cardFor('Total');
    expect(within(totalCard).getByText('3')).toBeInTheDocument();
    expect(within(totalCard).getByText(/candidates/i)).toBeInTheDocument();

    // 2 pending drafts
    const draftsCard = cardFor('Drafts');
    expect(within(draftsCard).getByText('2')).toBeInTheDocument();
    expect(within(draftsCard).getByText(/pending/i)).toBeInTheDocument();

    // 1 INTERESTED in fixture → "Need reply" metric == 1
    const needReplyCard = cardFor('Need reply');
    expect(within(needReplyCard).getByText('1')).toBeInTheDocument();
  });

  it('lists each interested candidate in the priority queue', async () => {
    renderDashboard();
    expect(
      await screen.findByText('Ada Lovelace')
    ).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    // Non-interested candidates are NOT in the priority queue
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();
    expect(screen.queryByText('Alan Turing')).not.toBeInTheDocument();
  });

  it('clicking an interested candidate row calls onOpenDraftForCandidate with the candidate id', async () => {
    const onOpenDraftForCandidate = vi.fn();
    const user = userEvent.setup();
    renderDashboard({
      onRefetchMailboxes: () => {},
      onOpenDraftForCandidate,
    });

    const nameCell = await screen.findByText('Ada Lovelace');
    const row = nameCell.closest('tr');
    expect(row).not.toBeNull();
    await user.click(row!);

    expect(onOpenDraftForCandidate).toHaveBeenCalledTimes(1);
    expect(onOpenDraftForCandidate).toHaveBeenCalledWith('cand-interested');
  });

  it('renders the "All caught up" empty state when no candidates need replies', async () => {
    fetchCandidatesMock.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 1000 },
    });
    fetchDraftsMock.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 1000 },
    });

    renderDashboard();
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
  });
});
