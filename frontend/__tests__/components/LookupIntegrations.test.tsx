import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import LookupIntegrations from '../../src/components/LookupIntegrations';
import { TooltipProvider } from '../../src/components/ui/tooltip';

// The Lever chip's detail is a ui/tooltip (R3); main.tsx provides this in the app.
const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

vi.mock('../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn().mockResolvedValue({
    configured: true,
    createEnabled: true,
    appEmail: 'paul.b@archive.com',
    leverUser: { id: 'lu', name: 'Paul' },
  }),
}));

const primary = {
  id: 'opp1',
  postingTitle: 'Founding Engineer',
  stage: 'Interest Call',
  archived: false,
  hired: false,
  archivedReason: null,
  createdAt: null,
  updatedAt: null,
  leverUrl: 'https://hire.lever.co/candidates/opp1',
};

describe('<LookupIntegrations /> (F2 Lever slot)', () => {
  it('is hidden when no integration is configured', () => {
    render(<LookupIntegrations data={{}} />);
    expect(screen.getByTestId('lookup-integrations')).not.toBeVisible();
    expect(screen.queryByTestId('lever-lookup')).toBeNull();
  });

  it('shows the Lever row with a link to the opportunity', () => {
    render(
      <LookupIntegrations
        data={{
          lever: {
            status: 'FOUND',
            state: 'ACTIVE',
            primary,
            opportunities: [primary],
            opportunityCount: 1,
            checkedAt: '2026-10-22T12:00:00.000Z',
          },
        }}
      />
    );
    const section = screen.getByTestId('lookup-integrations');
    expect(section).toBeVisible();
    expect(within(section).getByText('Lever')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /In Lever/ })).toHaveAttribute(
      'href',
      'https://hire.lever.co/candidates/opp1'
    );
  });

  it('shows Not in Lever for a NOT_FOUND result', () => {
    render(
      <LookupIntegrations
        data={{
          lever: { status: 'NOT_FOUND', state: 'NOT_FOUND', primary: null, opportunities: [], opportunityCount: 0, checkedAt: 'x' },
        }}
      />
    );
    expect(screen.getByTestId('lever-badge')).toHaveTextContent('Not in Lever');
  });

  it('F3: offers "Add to Lever" for a looked-up email that is not in Lever', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <LookupIntegrations
          email="new@example.com"
          candidateId={null}
          data={{
            lever: {
              status: 'NOT_FOUND',
              state: 'NOT_FOUND',
              primary: null,
              opportunities: [],
              opportunityCount: 0,
              checkedAt: '2026-10-22T12:00:00.000Z',
            },
          }}
        />
      </QueryClientProvider>
    );
    expect(await screen.findByRole('button', { name: 'Add to Lever' })).toBeInTheDocument();
  });
});
