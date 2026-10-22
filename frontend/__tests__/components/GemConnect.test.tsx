import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import GemConnect from '../../src/components/GemConnect';
import * as leverApi from '../../src/lib/leverApi';

vi.mock('../../src/lib/leverApi', () => ({
  fetchGemStatus: vi.fn(),
  startGemConnect: vi.fn(),
  disconnectGem: vi.fn(),
}));
const api = vi.mocked(leverApi);

let qc: QueryClient;
function wrap() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GemConnect navigate={nav} />
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

describe('GemConnect', () => {
  it('not connected → "Connect" sends the browser to Gem', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null });
    api.startGemConnect.mockResolvedValue('https://www.gem.com/oauth/mcp/authorize?x=1');
    wrap();
    expect(await screen.findByText('Gem: not connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(nav).toHaveBeenCalledWith('https://www.gem.com/oauth/mcp/authorize?x=1'));
  });

  it('connected → shows Connected and can disconnect', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    api.disconnectGem.mockResolvedValue();
    wrap();
    expect(await screen.findByText('Gem: Connected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(api.disconnectGem).toHaveBeenCalled());
  });

  it('disconnect invalidates cached Add to Lever prefills (built for the old connection)', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'OK', lastError: null });
    api.disconnectGem.mockResolvedValue();
    wrap();
    qc.setQueryData(['lever-prefill', 'c:c1'], { stale: false });
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(qc.getQueryState(['lever-prefill', 'c:c1'])?.isInvalidated).toBe(true));
  });

  it('NEEDS_REAUTH → "Reconnect"', async () => {
    api.fetchGemStatus.mockResolvedValue({ status: 'NEEDS_REAUTH', lastError: 'invalid_grant' });
    wrap();
    expect(await screen.findByText('Gem: reconnect needed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });
});
