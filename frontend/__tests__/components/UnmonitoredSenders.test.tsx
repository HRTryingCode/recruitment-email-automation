import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UnmonitoredSenders from '../../src/components/UnmonitoredSenders';
import type { SenderCoverageReport } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchSenderCoverage: vi.fn(),
  fetchExpectedSenders: vi.fn(),
  upsertExpectedSender: vi.fn(),
  deleteExpectedSender: vi.fn(),
}));

const fetchSenderCoverageMock = vi.mocked(api.fetchSenderCoverage);
const fetchExpectedSendersMock = vi.mocked(api.fetchExpectedSenders);
const upsertExpectedSenderMock = vi.mocked(api.upsertExpectedSender);

const REPORT: SenderCoverageReport = {
  generatedAt: '2026-10-22T12:00:00.000Z',
  windowDays: 30,
  expectedSenderCount: 4,
  unmonitored: [
    { emailAddress: 'ethan@archive.com', displayName: 'Ethan (Gem)', sources: ['ADMIN'], expectedSends30d: 478 },
    { emailAddress: 'pbenigeri@archive.com', displayName: null, sources: ['ADMIN'], expectedSends30d: null },
  ],
  quietMailboxes: [
    {
      mailboxId: 'mb-paul',
      emailAddress: 'paul.benigeri@archive.com',
      outbound30d: 0,
      expectedAddresses: ['p.benigeri@archive.com'],
      expectedSends30d: 200,
    },
  ],
  mailboxes: [],
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UnmonitoredSenders />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchExpectedSendersMock.mockResolvedValue({ success: true, data: [] });
});

describe('<UnmonitoredSenders />', () => {
  it('lists unmonitored senders and quiet mailboxes', async () => {
    fetchSenderCoverageMock.mockResolvedValue({ success: true, data: REPORT });
    renderPanel();
    expect(await screen.findByText('ethan@archive.com')).toBeInTheDocument();
    expect(screen.getByText('pbenigeri@archive.com')).toBeInTheDocument();
    expect(screen.getByText(/~478 sends/)).toBeInTheDocument();
    expect(screen.getByText('paul.benigeri@archive.com')).toBeInTheDocument();
    expect(screen.getByText(/2 unmonitored/i)).toBeInTheDocument();
  });

  it('shows an all-clear state when there are no gaps', async () => {
    fetchSenderCoverageMock.mockResolvedValue({
      success: true,
      data: { ...REPORT, unmonitored: [], quietMailboxes: [] },
    });
    renderPanel();
    expect(await screen.findByText(/all expected senders are monitored/i)).toBeInTheDocument();
  });

  it('renders nothing when the coverage request fails', async () => {
    fetchSenderCoverageMock.mockRejectedValue(new Error('500'));
    const { container } = renderPanel();
    await waitFor(() => expect(fetchSenderCoverageMock).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('lets an admin add an expected sender', async () => {
    fetchSenderCoverageMock.mockResolvedValue({ success: true, data: REPORT });
    upsertExpectedSenderMock.mockResolvedValue({
      success: true,
      data: { id: 'es1', emailAddress: 'michael@archive.com', displayName: null, source: 'ADMIN', expectedSends30d: null, notes: null, isActive: true },
    });
    renderPanel();
    await screen.findByText('ethan@archive.com');
    await userEvent.click(screen.getByRole('button', { name: /sender coverage/i }));
    await userEvent.type(screen.getByLabelText(/expected sender email/i), 'michael@archive.com');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() =>
      expect(upsertExpectedSenderMock).toHaveBeenCalledWith({ emailAddress: 'michael@archive.com' })
    );
  });

  it('hides the admin list for non-admins (403)', async () => {
    fetchSenderCoverageMock.mockResolvedValue({ success: true, data: REPORT });
    fetchExpectedSendersMock.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    renderPanel();
    await screen.findByText('ethan@archive.com');
    await userEvent.click(screen.getByRole('button', { name: /sender coverage/i }));
    await waitFor(() => expect(fetchExpectedSendersMock).toHaveBeenCalled());
    expect(screen.queryByLabelText(/expected sender email/i)).not.toBeInTheDocument();
  });
});
