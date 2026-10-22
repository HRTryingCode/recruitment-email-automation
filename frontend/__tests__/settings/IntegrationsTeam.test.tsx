import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IntegrationsSettings from '../../src/pages/settings/IntegrationsSettings';
import TeamSettings from '../../src/pages/settings/TeamSettings';
import * as api from '../../src/lib/api';
import * as leverApi from '../../src/lib/leverApi';

vi.mock('../../src/lib/api', () => ({ fetchDraftCcOptions: vi.fn() }));
vi.mock('../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn(),
  fetchGemStatus: vi.fn(),
  startGemConnect: vi.fn(),
  disconnectGem: vi.fn(),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('Settings → Integrations', () => {
  it('shows Gem connection and read-only Lever status', async () => {
    vi.mocked(leverApi.fetchGemStatus).mockResolvedValue({ status: 'OK', lastError: null });
    vi.mocked(leverApi.fetchLeverMe).mockResolvedValue({
      configured: true, createEnabled: false, appEmail: 'rae@archive.com', leverUser: { id: 'lu1', name: 'Rae R' },
    });
    wrap(<IntegrationsSettings />);
    expect(await screen.findByText('Connected')).toHaveAttribute('data-status', 'OK');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(await screen.findByText('Configured')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Rae R')).toBeInTheDocument();
  });

  it('says so when the Lever status cannot load', async () => {
    vi.mocked(leverApi.fetchGemStatus).mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null });
    vi.mocked(leverApi.fetchLeverMe).mockRejectedValue(new Error('500'));
    wrap(<IntegrationsSettings />);
    expect(await screen.findByText(/could not load the lever status/i)).toBeInTheDocument();
  });
});

describe('Settings → Team', () => {
  it('lists admins from the CC options, without the "No CC" sentinel', async () => {
    vi.mocked(api.fetchDraftCcOptions).mockResolvedValue({
      success: true,
      data: [
        { email: null, name: 'No CC', firstName: null },
        { email: 'andriy@archive.com', name: 'Andriy K', firstName: 'Andriy' },
      ],
    });
    wrap(<TeamSettings />);
    expect(await screen.findByText('andriy@archive.com')).toBeInTheDocument();
    expect(screen.getByText('Andriy K')).toBeInTheDocument();
    expect(screen.queryByText('No CC')).not.toBeInTheDocument();
  });

  it('degrades quietly when the list is unavailable', async () => {
    vi.mocked(api.fetchDraftCcOptions).mockRejectedValue(new Error('403'));
    wrap(<TeamSettings />);
    expect(await screen.findByText(/team list is not available/i)).toBeInTheDocument();
  });
});
