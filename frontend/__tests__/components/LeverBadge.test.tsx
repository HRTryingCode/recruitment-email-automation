import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LeverBadge, { CandidateLeverBadge, LeverLookupPanel } from '../../src/components/LeverBadge';
import type { LeverLookupIntegration } from '../../src/lib/api';

describe('LeverBadge', () => {
  it('ACTIVE: shows posting · stage and links to the opportunity in Lever', () => {
    render(
      <LeverBadge
        state="ACTIVE"
        opportunityId="opp-1"
        postingTitle="Founding Engineer"
        stage="Interest Call"
      />
    );
    const link = screen.getByRole('link', { name: /In Lever/ });
    expect(link).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp-1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('Founding Engineer · Interest Call');
  });

  it('ACTIVE without a posting falls back to the stage only', () => {
    render(<LeverBadge state="ACTIVE" opportunityId="o" stage="New lead" />);
    expect(screen.getByRole('link')).toHaveTextContent('In Lever · New lead');
  });

  it('ARCHIVED: shows the archive reason', () => {
    render(<LeverBadge state="ARCHIVED" opportunityId="o" archivedReason="Underqualified" />);
    expect(screen.getByRole('link')).toHaveTextContent('Archived · Underqualified');
  });

  it('HIRED', () => {
    render(<LeverBadge state="HIRED" opportunityId="o" postingTitle="Designer" />);
    expect(screen.getByRole('link')).toHaveTextContent('Hired · Designer');
  });

  it('NOT_FOUND: plain, no link', () => {
    render(<LeverBadge state="NOT_FOUND" />);
    expect(screen.getByTestId('lever-badge')).toHaveTextContent('Not in Lever');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ERROR: muted Unknown with the reason in the tooltip', () => {
    render(<LeverBadge state="ERROR" error="http_503" />);
    const badge = screen.getByTestId('lever-badge');
    expect(badge).toHaveTextContent('Lever unknown');
    expect(badge).toHaveAttribute('title', expect.stringContaining('http_503'));
    expect(badge).toHaveAttribute('data-state', 'ERROR');
  });

  it('never checked: muted Unknown with a "not checked yet" tooltip', () => {
    render(<LeverBadge state={null} />);
    expect(screen.getByTestId('lever-badge')).toHaveAttribute('title', expect.stringMatching(/not checked yet/i));
  });
});

describe('CandidateLeverBadge', () => {
  it('reads the cached lever columns off a candidate row', () => {
    render(
      <CandidateLeverBadge
        candidate={{
          leverState: 'ARCHIVED',
          leverOpportunityId: 'opp-9',
          leverPostingTitle: null,
          leverStage: 'Phone Screen',
          leverArchivedReason: 'Withdrew',
          leverCheckedAt: '2026-10-22T09:00:00.000Z',
          leverError: null,
        }}
      />
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp-9');
    expect(screen.getByRole('link')).toHaveTextContent('Archived · Withdrew');
  });
});

describe('LeverLookupPanel', () => {
  const opp = (id: string, extra: Partial<LeverLookupIntegration['opportunities'][number]> = {}) => ({
    id,
    postingTitle: 'Founding Engineer',
    stage: 'Interest Call',
    archived: false,
    hired: false,
    archivedReason: null,
    createdAt: null,
    updatedAt: null,
    leverUrl: `https://hire.lever.co/candidates/${id}`,
    ...extra,
  });

  it('renders nothing when the integration is absent (unconfigured)', () => {
    const { container } = render(<LeverLookupPanel integration={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the primary badge and other opportunities', () => {
    const integration: LeverLookupIntegration = {
      status: 'FOUND',
      state: 'ACTIVE',
      primary: opp('o1'),
      opportunities: [opp('o1'), opp('o0', { archived: true, archivedReason: 'Timing', postingTitle: 'Designer' })],
      opportunityCount: 2,
      checkedAt: '2026-10-22T12:00:00.000Z',
    };
    render(<LeverLookupPanel integration={integration} />);
    expect(screen.getByRole('link', { name: /In Lever/ })).toHaveTextContent('Founding Engineer · Interest Call');
    expect(screen.getByText(/Designer/)).toBeInTheDocument();
    expect(screen.getByText(/Timing/)).toBeInTheDocument();
  });

  it('shows ERROR from the lookup as muted Unknown', () => {
    render(
      <LeverLookupPanel
        integration={{
          status: 'ERROR',
          state: 'ERROR',
          message: 'Lever request failed (timeout)',
          primary: null,
          opportunities: [],
          opportunityCount: 0,
          checkedAt: '2026-10-22T12:00:00.000Z',
        }}
      />
    );
    expect(screen.getByTestId('lever-badge')).toHaveAttribute('title', expect.stringContaining('timeout'));
  });
});
