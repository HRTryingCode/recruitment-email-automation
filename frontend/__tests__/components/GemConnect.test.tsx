import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GemConnect, { GEM_PREFILL_LINE } from '../../src/components/GemConnect';
import * as leverApi from '../../src/lib/leverApi';

vi.mock('../../src/lib/leverApi', () => ({
  fetchGemStatus: vi.fn(),
  startGemConnect: vi.fn(),
  disconnectGem: vi.fn(),
}));
const api = vi.mocked(leverApi);

let qc: QueryClient;
function wrap(variant?: 'card' | 'menu') {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <GemConnect navigate={nav} variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
const nav = vi.fn();

beforeEach(() => {
  api.fetchGemStatus.mockReset();
  api.startGemConnect.mockReset();
  api.disconnectGem.mockReset();
  nav.mockReset();
});

async function confirmDisconnect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
}

describe('GemConnect', () => {
  it('not connected → "Connect" sends the browser to Gem; says what Gem prefills', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null });
    api.startGemConnect.mockResolvedValue('https://www.gem.com/oauth/mcp/authorize?x=1');
    wrap();
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(GEM_PREFILL_LINE)).toHaveTextContent('LinkedIn, title, location and résumé');
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(nav).toHaveBeenCalledWith('https://www.gem.com/oauth/mcp/authorize?x=1'));
  });

  it('shows a skeleton while loading, not a blank card', () => {
    api.fetchGemStatus.mockReturnValue(new Promise(() => {}));
    const { container } = wrap();
    expect(screen.getByTestId('gem-connect-loading')).toBeInTheDocument();
    expect(container.querySelector('[data-slot=skeleton]')).not.toBeNull();
  });

  it('a failed status load says so and Retry refetches', async () => {
    api.fetchGemStatus.mockRejectedValueOnce(new Error('500')).mockResolvedValueOnce({ status: 'OK', lastError: null });
    wrap();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your Gem connection");
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(api.fetchGemStatus).toHaveBeenCalledTimes(2);
  });

  it('connected → Disconnect asks first; Cancel keeps the connection', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    wrap();
    expect(await screen.findByText('Connected')).toHaveAttribute('data-status', 'OK');
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Disconnect Gem?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.disconnectGem).not.toHaveBeenCalled();
  });

  it('confirming disconnects', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    api.disconnectGem.mockResolvedValue();
    wrap();
    await confirmDisconnect();
    await waitFor(() => expect(api.disconnectGem).toHaveBeenCalled());
  });

  it('disconnect invalidates cached Add to Lever prefills (built for the old connection)', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    api.disconnectGem.mockResolvedValue();
    wrap();
    qc.setQueryData(['lever-prefill', 'c:c1'], { stale: false });
    await confirmDisconnect();
    await waitFor(() => expect(qc.getQueryState(['lever-prefill', 'c:c1'])?.isInvalidated).toBe(true));
  });

  it('NEEDS_REAUTH → warning badge and "Reconnect"', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'NEEDS_REAUTH', lastError: 'invalid_grant' });
    wrap();
    expect(await screen.findByText('Reconnect needed')).toHaveAttribute('data-variant', 'warning');
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('menu variant: one line, and Manage links to Settings instead of disconnecting there', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    wrap('menu');
    expect(await screen.findByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/settings/integrations');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByText(GEM_PREFILL_LINE)).toBeNull();
  });
});
