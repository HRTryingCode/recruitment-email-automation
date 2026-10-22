import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import InboxPage from '../../../src/pages/InboxPage';
import { TooltipProvider } from '../../../src/components/ui/tooltip';
import { Toaster } from '../../../src/components/ui/sonner';

export const location = { current: '' };

function LocationSpy() {
  const loc = useLocation();
  location.current = `${loc.pathname}${loc.search}`;
  return null;
}

export function search(): URLSearchParams {
  return new URLSearchParams(location.current.split('?')[1] ?? '');
}

export function renderInbox(url = '/inbox') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TooltipProvider>
          <Routes>
            <Route path="/inbox" element={<InboxPage />} />
          </Routes>
          <LocationSpy />
          <Toaster />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
