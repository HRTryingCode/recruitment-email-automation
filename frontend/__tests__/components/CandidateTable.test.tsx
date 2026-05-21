import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateTable from '../../src/components/CandidateTable';
import { TooltipProvider } from '../../src/components/ui/Tooltip';
import type { Candidate } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchMessages: vi.fn(),
  updateCandidate: vi.fn(),
  ignoreCandidate: vi.fn(),
  unignoreCandidate: vi.fn(),
}));

const fetchCandidatesMock = vi.mocked(api.fetchCandidates);
const ignoreCandidateMock = vi.mocked(api.ignoreCandidate);

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

function renderTable() {
  const client = createClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
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
});

