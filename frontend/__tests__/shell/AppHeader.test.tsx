import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppHeader from '../../src/components/shell/AppHeader';
import { SidebarProvider } from '../../src/components/ui/sidebar';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import type { Mailbox } from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchLookup: vi.fn(),
  fetchCandidates: vi.fn(),
  fetchSyncHealth: vi.fn().mockResolvedValue({ success: true, data: [] }),
  fetchMailboxes: vi.fn().mockResolvedValue({ success: true, data: [] }),
  addGmailMailbox: vi.fn(),
  fetchGemStatus: vi.fn().mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null }),
}));
vi.mock('../../src/lib/leverApi', () => ({
  fetchGemStatus: vi.fn().mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null }),
}));

const MAILBOXES = [
  { id: 'mb1', emailAddress: 'sofia@archive.com' },
  { id: 'mb2', emailAddress: 'paul@archive.com' },
] as Mailbox[];

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <TooltipProvider>
          <SidebarProvider>
            <AppHeader mailboxes={MAILBOXES} onMailboxChange={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppHeader mailbox filter (U2a)', () => {
  it.each(['/inbox', '/candidates', '/today'])('is in the header on %s from sm up', (path) => {
    renderAt(path);
    const filter = screen.getByRole('combobox', { name: 'Mailbox filter' });
    // Below sm it is hidden; ⌘K "Filter by mailbox" covers phones.
    expect(filter.closest('[data-slot=mailbox-filter]')).toHaveClass('hidden', 'sm:flex');
  });

  it.each(['/settings/mailboxes', '/settings/team'])('is not shown on %s (settings are not per-mailbox)', (path) => {
    renderAt(path);
    expect(screen.queryByRole('combobox', { name: 'Mailbox filter' })).not.toBeInTheDocument();
  });
});
