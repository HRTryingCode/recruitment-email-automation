import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateTable from '../../src/components/CandidateTable';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import type { Candidate } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchMessages: vi.fn(),
  updateCandidate: vi.fn(),
  ignoreCandidate: vi.fn(),
  unignoreCandidate: vi.fn(),
  generateDraftForThread: vi.fn(),
  // H1 auto-refresh of never-checked Lever rows; never settles here.
  refreshCandidateLever: vi.fn(() => new Promise(() => {})),
}));

const fetchCandidatesMock = vi.mocked(api.fetchCandidates);
const ignoreCandidateMock = vi.mocked(api.ignoreCandidate);
const updateCandidateMock = vi.mocked(api.updateCandidate);
const generateDraftMock = vi.mocked(api.generateDraftForThread);

const STATUS_LABELS: Record<string, string> = {
  INTERESTED: 'Interested',
  NEEDS_REVIEW: 'Needs Review',
  IGNORED: 'Ignored',
  NOT_INTERESTED: 'Not Interested',
  NEUTRAL: 'Neutral',
};

// Status badge color tokens. Chromatic statuses use a darker shade in light
// mode (700) and the original soft shade in dark (300). Neutral/ignored use
// theme-aware fg-* tokens so they flip automatically.
const STATUS_TONE_CLASS: Record<string, RegExp> = {
  INTERESTED: /text-emerald-700/,
  NEEDS_REVIEW: /text-amber-700/,
  IGNORED: /text-fg-muted/,
  NOT_INTERESTED: /text-rose-700/,
  NEUTRAL: /text-fg-default/,
};

function makeCandidate(
  overrides: Partial<Candidate> & Pick<Candidate, 'id' | 'name' | 'email' | 'status'>
): Candidate {
  return {
    company: 'Example Inc.',
    mailboxId: 'mb-1',
    createdAt: '2026-05-19T10:00:00.000Z',
    updatedAt: '2026-05-20T10:00:00.000Z',
    ...overrides,
  };
}

const CANDIDATES: Candidate[] = [
  makeCandidate({
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    status: 'INTERESTED',
  }),
  makeCandidate({
    id: 'c2',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    status: 'NEEDS_REVIEW',
    threads: [
      {
        id: 't2',
        mailboxId: 'mb-1',
        externalThreadId: 'ext-2',
        subject: 'Re: role',
        lastMessageAt: '2026-05-20T10:00:00.000Z',
        createdAt: '2026-05-19T10:00:00.000Z',
      },
    ],
  }),
  makeCandidate({
    id: 'c3',
    name: 'Alan Turing',
    email: 'alan@example.com',
    status: 'IGNORED',
  }),
  makeCandidate({
    id: 'c4',
    name: 'Marie Curie',
    email: 'marie@example.com',
    status: 'NOT_INTERESTED',
  }),
  makeCandidate({
    id: 'c5',
    name: 'Linus Torvalds',
    email: 'linus@example.com',
    status: 'NEUTRAL',
  }),
];

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderTable(initialEntry = '/') {
  const client = createClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <TooltipProvider>
          <CandidateTable />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<CandidateTable />', () => {
  beforeEach(() => {
    fetchCandidatesMock.mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 100 },
    });
    ignoreCandidateMock.mockResolvedValue({
      success: true,
      data: { ...CANDIDATES[0], status: 'IGNORED' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a row for each candidate fixture', async () => {
    renderTable();
    for (const c of CANDIDATES) {
      expect(await screen.findByText(c.name)).toBeInTheDocument();
      expect(screen.getByText(c.email)).toBeInTheDocument();
    }
  });

  it('renders a status badge with the correct label + tone for each status', async () => {
    renderTable();
    await screen.findByText('Ada Lovelace');

    for (const c of CANDIDATES) {
      const label = STATUS_LABELS[c.status];
      // Each row contains both a StatusBadge <span> and an action <select>
      // whose <option>s include every label. Scope to <span> to find the
      // badge only.
      const row = screen.getByText(c.name).closest('tr')!;
      const badge = within(row).getByText(label, { selector: 'span' });
      expect(badge).toBeInTheDocument();
      expect(badge.className).toMatch(STATUS_TONE_CLASS[c.status]);
    }
  });

  it('clicking Ignore + confirming triggers the ignoreCandidate mutation with the right id', async () => {
    const user = userEvent.setup();
    renderTable();

    const adaRow = (await screen.findByText('Ada Lovelace')).closest('tr')!;
    const ignoreTrigger = within(adaRow).getByLabelText(/ignore candidate/i);
    await user.click(ignoreTrigger);

    // The trigger and the confirm button share an accessible name; scope
    // to the alertdialog Radix portals to <body>.
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: /^ignore candidate$/i,
    });
    await user.click(confirm);

    await waitFor(() => {
      expect(ignoreCandidateMock).toHaveBeenCalledWith('c1');
    });
    expect(ignoreCandidateMock).toHaveBeenCalledTimes(1);
  });

  it('renders a pagination footer when total exceeds the page limit (Phase AR bug #9)', async () => {
    fetchCandidatesMock.mockResolvedValue({
      success: true,
      data: CANDIDATES,
      // total deliberately greater than limit so the footer kicks in
      meta: { total: 1500, page: 1, limit: 500 },
    });

    renderTable();
    await screen.findByText('Ada Lovelace');

    const footer = await screen.findByTestId('candidates-pagination-footer');
    expect(footer).toBeInTheDocument();
    expect(footer.textContent).toMatch(/Showing 1.{1,2}500 of 1500/);
    // L16: the button pages forward; it never appended, so it no longer says "Load more".
    expect(within(footer).getByRole('button', { name: /^next$/i })).toBeEnabled();
    expect(within(footer).getByRole('button', { name: /previous/i })).toBeDisabled();
  });

  it('does NOT render the pagination footer when total fits on a single page', async () => {
    // Default fixture has total=5, limit=100 → no footer expected.
    renderTable();
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByTestId('candidates-pagination-footer')).not.toBeInTheDocument();
  });

  it('changing the status filter refetches with the new status param', async () => {
    const user = userEvent.setup();
    renderTable();

    await screen.findByText('Ada Lovelace');

    // Initial fetch: status is unset → apiStatus undefined
    expect(fetchCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined })
    );

    // Switch to "Interested" → re-fetch with status: 'INTERESTED'
    const select = screen.getByDisplayValue(/active candidates/i);
    await user.selectOptions(select, 'INTERESTED');

    await waitFor(() => {
      expect(fetchCandidatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'INTERESTED' })
      );
    });

    // Switch to "Ignored" → re-fetch with status: 'IGNORED' AND includeIgnored
    await user.selectOptions(select, 'IGNORED');
    await waitFor(() => {
      expect(fetchCandidatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'IGNORED', includeIgnored: true })
      );
    });
  });

  it('applies the dashboard ?filter=AWAITING_REPLY as a server-side replyStatus filter (M19)', async () => {
    renderTable('/?tab=candidates&filter=AWAITING_REPLY');
    await screen.findByText('Ada Lovelace');
    expect(fetchCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ replyStatus: 'AWAITING_REPLY', status: undefined })
    );
    expect(screen.getByDisplayValue(/awaiting reply/i)).toBeInTheDocument();
  });

  it('applies ?filter=NEEDS_REVIEW as a status filter (M19)', async () => {
    renderTable('/?tab=candidates&filter=NEEDS_REVIEW');
    await screen.findByText('Ada Lovelace');
    expect(fetchCandidatesMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEEDS_REVIEW' }));
  });

  it('choosing Ignored in a row dropdown goes through the ignore flow (M20)', async () => {
    const user = userEvent.setup();
    renderTable();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr')!;
    await user.selectOptions(within(row).getByRole('combobox'), 'IGNORED');
    await waitFor(() => expect(ignoreCandidateMock).toHaveBeenCalledWith('c1'));
    expect(updateCandidateMock).not.toHaveBeenCalled();
  });

  it('sorting asks the server to sort, across all pages (L16)', async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /^name$/i }));
    await waitFor(() =>
      expect(fetchCandidatesMock).toHaveBeenCalledWith(expect.objectContaining({ sort: 'name', dir: 'asc' }))
    );
  });

  it('debounces search so typing does not fire a request per keystroke (L16)', async () => {
    const user = userEvent.setup();
    renderTable();
    await screen.findByText('Ada Lovelace');
    await user.type(screen.getByPlaceholderText(/search by name or email/i), 'ada');
    await waitFor(() =>
      expect(fetchCandidatesMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'ada' }))
    );
    const searches = fetchCandidatesMock.mock.calls.map((c) => c[0]?.search).filter(Boolean);
    expect(searches).not.toContain('a');
    expect(searches).not.toContain('ad');
  });

  it('seeds the search from ?q= (F1 lookup "Open conversation" deep link)', async () => {
    renderTable('/?tab=candidates&q=ada%40example.com');
    expect(screen.getByPlaceholderText(/search by name or email/i)).toHaveValue('ada@example.com');
    await waitFor(() =>
      expect(fetchCandidatesMock).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'ada@example.com' })
      )
    );
  });

  it('NEEDS_REVIEW triage: "Interested + draft" sets the status and generates a draft (M17)', async () => {
    const user = userEvent.setup();
    updateCandidateMock.mockResolvedValue({ success: true, data: { ...CANDIDATES[1], status: 'INTERESTED' } });
    generateDraftMock.mockResolvedValue({ success: true, data: {} as never });
    renderTable();
    const row = (await screen.findByText('Grace Hopper')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /interested \+ draft/i }));
    await waitFor(() => expect(generateDraftMock).toHaveBeenCalledWith('t2', 'INTERESTED'));
    expect(updateCandidateMock).toHaveBeenCalledWith('c2', { status: 'INTERESTED' });
  });

  it('NEEDS_REVIEW triage: "Not interested" sets the status without drafting (M17)', async () => {
    const user = userEvent.setup();
    updateCandidateMock.mockResolvedValue({ success: true, data: { ...CANDIDATES[1], status: 'NOT_INTERESTED' } });
    renderTable();
    const row = (await screen.findByText('Grace Hopper')).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: /^not interested$/i }));
    await waitFor(() => expect(updateCandidateMock).toHaveBeenCalledWith('c2', { status: 'NOT_INTERESTED' }));
    expect(generateDraftMock).not.toHaveBeenCalled();
  });

  it('triage buttons only appear on NEEDS_REVIEW rows', async () => {
    renderTable();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr')!;
    expect(within(row).queryByRole('button', { name: /interested \+ draft/i })).not.toBeInTheDocument();
  });
});
