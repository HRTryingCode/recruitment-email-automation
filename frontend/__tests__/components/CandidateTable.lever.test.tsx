import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CandidateTable from '../../src/components/CandidateTable';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import type { Candidate } from '../../src/lib/api';
import * as api from '../../src/lib/api';
import { resetLeverAutoRefreshForTests } from '../../src/lib/leverAutoRefresh';

// The table's own module mocks (fetchCandidates etc.) plus `mailboxes`/
// `counts` if a future version calls them; only fetchCandidates matters here.
vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchCandidateCounts: vi.fn(),
  fetchMessages: vi.fn(),
  updateCandidate: vi.fn(),
  ignoreCandidate: vi.fn(),
  unignoreCandidate: vi.fn(),
  refreshCandidateLever: vi.fn(),
}));

// F3: the Add to Lever button asks /api/lever/me whether it may show.
vi.mock('../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn().mockResolvedValue({
    configured: true,
    createEnabled: true,
    appEmail: 'paul.b@archive.com',
    leverUser: { id: 'lu', name: 'Paul' },
  }),
  // H5: selecting a row prefetches the Add to Lever dialog's data.
  fetchLeverPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverGemPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverPostings: vi.fn().mockReturnValue(new Promise(() => {})),
}));
import * as leverApi from '../../src/lib/leverApi';

const base = { mailboxId: 'mb-1', createdAt: '2026-05-19T10:00:00.000Z', updatedAt: '2026-05-20T10:00:00.000Z' };
const CANDIDATES: Candidate[] = [
  {
    ...base,
    id: 'c1',
    name: 'Arron Gould',
    email: 'arron@arrongould.com',
    status: 'INTERESTED',
    leverState: 'ACTIVE',
    leverOpportunityId: 'opp-1',
    leverPostingTitle: 'Founding Engineer',
    leverStage: 'Interest Call',
  },
  { ...base, id: 'c2', name: 'Nobody Known', email: 'n@example.com', status: 'NEUTRAL', leverState: 'NOT_FOUND' },
  { ...base, id: 'c3', name: 'Never Checked', email: 'q@example.com', status: 'NEUTRAL' },
];

function renderTable() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <TooltipProvider>
          <CandidateTable />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetLeverAutoRefreshForTests();
  vi.mocked(api.refreshCandidateLever).mockReset();
  vi.mocked(api.refreshCandidateLever).mockReturnValue(new Promise(() => {}));
});

describe('<CandidateTable /> Lever badge (F2)', () => {
  it('the Lever filter refetches with lever=IN / NOT_IN', async () => {
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 100 },
    });
    renderTable();
    await screen.findByText('Arron Gould');
    expect(vi.mocked(api.fetchCandidates).mock.calls[0]![0]).toMatchObject({ lever: undefined });
    await userEvent.selectOptions(screen.getByLabelText('Lever filter'), 'IN');
    await waitFor(() =>
      expect(vi.mocked(api.fetchCandidates)).toHaveBeenLastCalledWith(expect.objectContaining({ lever: 'IN' }))
    );
    await userEvent.selectOptions(screen.getByLabelText('Lever filter'), 'NOT_IN');
    await waitFor(() =>
      expect(vi.mocked(api.fetchCandidates)).toHaveBeenLastCalledWith(expect.objectContaining({ lever: 'NOT_IN' }))
    );
  });

  it('shows the cached Lever status in each row', async () => {
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 100 },
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TooltipProvider>
            <CandidateTable />
          </TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
    const row1 = (await screen.findByText('Arron Gould')).closest('tr')!;
    expect(within(row1).getByRole('link', { name: /In Lever/ })).toHaveAttribute(
      'href',
      'https://hire.lever.co/candidates/opp-1'
    );
    const row2 = screen.getByText('Nobody Known').closest('tr')!;
    expect(within(row2).getByTestId('lever-badge')).toHaveTextContent('Not in Lever');
    const row3 = screen.getByText('Never Checked').closest('tr')!;
    expect(within(row3).getByTestId('lever-badge')).toHaveAttribute('data-state', 'CHECKING');
  });

  it('F3: "Add to Lever" on not-in-Lever rows, "Add to another job" on in-Lever rows, none when unchecked', async () => {
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 100 },
    });
    renderTable();
    const row2 = (await screen.findByText('Nobody Known')).closest('tr')!;
    expect(await within(row2).findByRole('button', { name: 'Add to Lever' })).toBeInTheDocument();
    const row1 = screen.getByText('Arron Gould').closest('tr')!;
    expect(within(row1).getByRole('button', { name: 'Add to another job' })).toBeInTheDocument();
    const row3 = screen.getByText('Never Checked').closest('tr')!;
    expect(within(row3).queryByRole('button', { name: /Add to/ })).toBeNull();
  });

  it('H5: selecting a row with an Add to Lever button prefetches the dialog data; unchecked rows do not', async () => {
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: CANDIDATES.length, page: 1, limit: 100 },
    });
    renderTable();
    await userEvent.click(await screen.findByText('Never Checked'));
    expect(leverApi.fetchLeverGemPrefill).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Nobody Known'));
    await waitFor(() => expect(leverApi.fetchLeverGemPrefill).toHaveBeenCalledWith({ candidateId: 'c2' }));
    expect(leverApi.fetchLeverPrefill).toHaveBeenCalledWith({ candidateId: 'c2' });
  });

  it('auto-refreshes only never-checked rows, once, and swaps in the result (H1)', async () => {
    const withError: Candidate = {
      ...base,
      id: 'c4',
      name: 'Errored Row',
      email: 'e@example.com',
      status: 'NEUTRAL',
      leverState: 'ERROR',
      leverError: 'timeout',
      leverCheckedAt: '2026-05-20T10:00:00.000Z',
    };
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: [...CANDIDATES, withError],
      meta: { total: 4, page: 1, limit: 100 },
    });
    vi.mocked(api.refreshCandidateLever).mockResolvedValue({
      success: true,
      data: {
        candidate: { ...CANDIDATES[2]!, leverState: 'NOT_FOUND', leverCheckedAt: '2026-10-22T12:00:00.000Z' },
        lever: { state: 'NOT_FOUND' },
      },
    });
    const { unmount } = renderTable();
    const row3 = (await screen.findByText('Never Checked')).closest('tr')!;
    await waitFor(() => expect(within(row3).getByTestId('lever-badge')).toHaveTextContent('Not in Lever'));
    expect(vi.mocked(api.refreshCandidateLever).mock.calls).toEqual([['c3']]);
    expect(within(screen.getByText('Errored Row').closest('tr')!).getByTestId('lever-badge')).toHaveTextContent(
      'Lever unknown'
    );

    // Remounting (tab switch) in the same session does not re-trigger it.
    unmount();
    vi.mocked(api.fetchCandidates).mockResolvedValue({
      success: true,
      data: CANDIDATES,
      meta: { total: 3, page: 1, limit: 100 },
    });
    renderTable();
    await screen.findByText('Never Checked');
    expect(vi.mocked(api.refreshCandidateLever)).toHaveBeenCalledTimes(1);
  });
});
