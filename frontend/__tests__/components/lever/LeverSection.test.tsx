// R2 reply-pane header: Lever section states, refresh, Open in Lever, and the
// post-create update (Add to Lever is stubbed; its own dialog is tested in AddToLever.test).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import LeverSection, { type LeverFields } from '../../../src/components/lever/LeverSection';
import * as toast from '../../../src/lib/toast';
import { TooltipProvider } from '../../../src/components/ui/tooltip';

vi.mock('../../../src/components/AddToLeverButton', () => ({
  default: ({ inLever, onCreated }: { inLever: boolean; onCreated?: (r: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onCreated?.({
          opportunityId: 'opp-new',
          leverUrl: 'https://hire.lever.co/candidates/opp-new',
          postingId: 'p1',
          postingTitle: 'Staff Engineer',
          stageName: 'Interest Call',
          resumeAttached: false,
          noteAdded: true,
          candidate: {
            id: 'c1',
            leverState: 'ACTIVE',
            leverOpportunityId: 'opp-new',
            leverPostingTitle: 'Staff Engineer',
            leverStage: 'Interest Call',
            leverCheckedAt: new Date().toISOString(),
          },
        })
      }
    >
      {inLever ? 'Add to another job' : 'Add to Lever'}
    </button>
  ),
}));
vi.mock('../../../src/lib/toast', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/toast')>()),
  toastError: vi.fn(),
}));

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.clearAllMocks();
});
afterAll(() => server.close());

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

function renderSection(lever: LeverFields) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <LeverSection candidateId="c1" lever={lever} draftId="d1" />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { invalidate, region: screen.getByRole('group', { name: 'Lever' }) };
}

describe('LeverSection', () => {
  it('in Lever: chip, job · stage, checked time, Open in Lever link, Add to another job', () => {
    const { region } = renderSection({
      leverState: 'ACTIVE',
      leverOpportunityId: 'opp1',
      leverPostingTitle: 'Senior Engineer',
      leverStage: 'Phone Screen',
      leverCheckedAt: ago(5),
    });
    expect(within(region).getByText('In Lever')).toBeInTheDocument();
    expect(within(region).getByText('Senior Engineer · Phone Screen')).toBeInTheDocument();
    expect(within(region).getByText('Checked 5m ago')).toBeInTheDocument();
    const link = within(region).getByRole('link', { name: /Open in Lever/ });
    expect(link).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(within(region).getByRole('button', { name: 'Add to another job' })).toBeInTheDocument();
  });

  it('archived: shows the archived reason', () => {
    const { region } = renderSection({
      leverState: 'ARCHIVED',
      leverOpportunityId: 'opp1',
      leverPostingTitle: 'Senior Engineer',
      leverArchivedReason: 'Withdrew',
      leverCheckedAt: ago(60),
    });
    expect(within(region).getByText('Archived')).toBeInTheDocument();
    expect(within(region).getByText('Withdrew')).toBeInTheDocument();
  });

  it('hired', () => {
    const { region } = renderSection({ leverState: 'HIRED', leverOpportunityId: 'opp1', leverCheckedAt: ago(60) });
    expect(within(region).getByText('Hired')).toBeInTheDocument();
  });

  it('not in Lever: Add to Lever and no Open link', () => {
    const { region } = renderSection({ leverState: 'NOT_FOUND', leverCheckedAt: ago(120) });
    expect(within(region).getByText('Not in Lever')).toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: /Open in Lever/ })).not.toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Add to Lever' })).toBeInTheDocument();
  });

  it('never checked: Checking Lever…', () => {
    const { region } = renderSection({ leverState: null });
    expect(within(region).getByText('Checking Lever…')).toBeInTheDocument();
  });

  it('refresh re-checks Lever and shows the new state', async () => {
    let calls = 0;
    server.use(
      http.post('*/api/candidates/c1/lever/refresh', () => {
        calls += 1;
        return HttpResponse.json({
          success: true,
          data: {
            candidate: { id: 'c1', leverState: 'ACTIVE', leverOpportunityId: 'opp9', leverPostingTitle: 'Designer', leverStage: 'Onsite', leverCheckedAt: new Date().toISOString() },
            lever: { state: 'ACTIVE' },
          },
        });
      })
    );
    const user = userEvent.setup();
    const { region, invalidate } = renderSection({ leverState: 'NOT_FOUND', leverCheckedAt: ago(300) });
    await user.click(within(region).getByRole('button', { name: 'Refresh Lever status' }));
    expect(await within(region).findByText('Designer · Onsite')).toBeInTheDocument();
    expect(within(region).getByText('In Lever')).toBeInTheDocument();
    expect(within(region).getByText('Checked now')).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inbox'] });
  });

  it('refresh failure shows a toast and keeps the old state', async () => {
    server.use(http.post('*/api/candidates/c1/lever/refresh', () => HttpResponse.json({ success: false, error: 'Lever timed out' }, { status: 502 })));
    const user = userEvent.setup();
    const { region } = renderSection({ leverState: 'NOT_FOUND', leverCheckedAt: ago(300) });
    await user.click(within(region).getByRole('button', { name: 'Refresh Lever status' }));
    await waitFor(() => expect(toast.toastError).toHaveBeenCalledWith("Couldn't refresh Lever", 'Lever timed out'));
    expect(within(region).getByText('Not in Lever')).toBeInTheDocument();
  });

  it('after Add to Lever succeeds the section updates at once and queries are invalidated', async () => {
    const user = userEvent.setup();
    const { region, invalidate } = renderSection({ leverState: 'NOT_FOUND', leverCheckedAt: ago(300) });
    await user.click(within(region).getByRole('button', { name: 'Add to Lever' }));
    expect(await within(region).findByText('In Lever')).toBeInTheDocument();
    expect(within(region).getByText('Staff Engineer · Interest Call')).toBeInTheDocument();
    expect(within(region).getByRole('link', { name: /Open in Lever/ })).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp-new');
    expect(within(region).getByRole('button', { name: 'Add to another job' })).toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inbox'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['draft', 'd1'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['candidate', 'c1'] });
  });
});
