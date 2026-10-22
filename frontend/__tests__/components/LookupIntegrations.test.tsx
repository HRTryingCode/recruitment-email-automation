import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LookupIntegrations from '../../src/components/LookupIntegrations';

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
});
