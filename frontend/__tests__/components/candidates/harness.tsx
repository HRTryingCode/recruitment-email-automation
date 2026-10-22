import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import CandidateTable from '../../../src/components/CandidateTable';
import { TooltipProvider } from '../../../src/components/ui/tooltip';
import type { Candidate, EmailThread } from '../../../src/lib/api';

// Shared by the R3 Candidates tests. Each test file mocks lib/api and
// lib/leverApi itself (vi.mock is hoisted per file).

export const location = { current: '' };

function LocationSpy() {
  const loc = useLocation();
  location.current = `${loc.pathname}${loc.search}`;
  return null;
}

export function search(): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(location.current.split('?')[1] ?? ''));
}

export function renderCandidates(url = '/candidates') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>
          <CandidateTable />
          <LocationSpy />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...utils };
}

const now = Date.now();
export const ago = (h: number) => new Date(now - h * 3600_000).toISOString();

export function makeCandidate(o: Partial<Candidate> & Pick<Candidate, 'id' | 'name' | 'email' | 'status'>): Candidate {
  return {
    mailboxId: 'mb-1',
    mailbox: { id: 'mb-1', emailAddress: 'rae@archive.com', provider: 'GMAIL' },
    createdAt: ago(200),
    updatedAt: ago(100),
    leverState: 'NOT_FOUND',
    leverCheckedAt: ago(1),
    ...o,
  };
}

export const CANDIDATES: Candidate[] = [
  makeCandidate({
    id: 'c1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    status: 'INTERESTED',
    role: 'Founding Engineer',
    lastInboundAt: ago(2),
    lastOutboundAt: ago(5),
    leverState: 'ACTIVE',
    leverOpportunityId: 'opp-1',
    leverPostingTitle: 'Founding Engineer',
    leverStage: 'Phone Screen',
  }),
  makeCandidate({
    id: 'c2',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    status: 'NEEDS_REVIEW',
    role: null,
    lastInboundAt: ago(30),
    threads: [{ id: 't2', subject: 'Re: role', lastMessageAt: ago(30) } as EmailThread],
  }),
  makeCandidate({ id: 'c3', name: 'Marie Curie', email: 'marie@example.com', status: 'NOT_INTERESTED', lastOutboundAt: ago(50) }),
  makeCandidate({ id: 'c4', name: 'Linus Torvalds', email: 'linus@example.com', status: 'NEUTRAL', leverState: null, leverCheckedAt: null }),
];

export function listResponse(data: Candidate[] = CANDIDATES, total = data.length) {
  return { success: true as const, data, meta: { total, page: 1, limit: 50 } };
}
