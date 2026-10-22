import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LookupBar from '../../src/components/LookupBar';
import type { LookupResult } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchLookup: vi.fn(),
  fetchCandidates: vi.fn(),
  fetchSyncHealth: vi.fn(),
  addGmailMailbox: vi.fn(),
}));

const fetchLookupMock = vi.mocked(api.fetchLookup);
const fetchCandidatesMock = vi.mocked(api.fetchCandidates);

function base(over: Partial<LookupResult>): LookupResult {
  return {
    email: 'bob@x.com',
    verdict: 'UNKNOWN',
    summary: 'No trace of this email in any connected mailbox',
    candidate: null,
    messages: {
      inbound: 0,
      outbound: 0,
      firstAt: null,
      lastAt: null,
      latestSubject: null,
      latestThreadId: null,
      mailboxes: [],
      truncated: false,
    },
    drafts: { total: 0, byStatus: {}, latest: null },
    skipped: { reasons: [], lastSkippedAt: null, windowDays: 90 },
    integrations: {},
    ...over,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderBar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <input aria-label="Other field" />
                <LookupBar />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openAndType(text: string) {
  const user = userEvent.setup();
  renderBar();
  await user.click(screen.getByRole('button', { name: /look up an email/i }));
  const box = await screen.findByRole('combobox', { name: /email to look up/i });
  await user.type(box, text);
  return { user, box };
}

beforeEach(() => {
  vi.resetAllMocks();
  fetchLookupMock.mockResolvedValue({ success: true, data: base({}) });
  fetchCandidatesMock.mockResolvedValue({ success: true, data: [], meta: { total: 0, page: 1, limit: 5 } });
  vi.mocked(api.fetchSyncHealth).mockResolvedValue({ success: true, data: [] });
});

describe('<LookupBar /> shortcuts', () => {
  it('opens with ⌘K and focuses the input', async () => {
    renderBar();
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    const box = await screen.findByRole('combobox', { name: /email to look up/i });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('opens with Ctrl-K', async () => {
    renderBar();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens with / when not typing in a field', async () => {
    renderBar();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('does not open with / while typing in another input', async () => {
    renderBar();
    const other = screen.getByLabelText('Other field');
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderBar();
    const trigger = screen.getByRole('button', { name: /look up an email/i });
    await user.click(trigger);
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('<LookupBar /> lookup', () => {
  it('debounces typing into a single lookup call with the full email', async () => {
    await openAndType('Bob@X.com');
    await screen.findByText('No trace of this email in any connected mailbox');
    expect(fetchLookupMock).toHaveBeenCalledTimes(1);
    expect(fetchLookupMock).toHaveBeenCalledWith('bob@x.com');
  });

  it('shows a hint and top-5 name/email matches for partial input', async () => {
    fetchCandidatesMock.mockResolvedValue({
      success: true,
      data: [
        { id: 'c1', name: 'Bob Builder', email: 'bob@x.com', status: 'INTERESTED', createdAt: '', updatedAt: '' },
      ],
      meta: { total: 1, page: 1, limit: 5 },
    } as Awaited<ReturnType<typeof api.fetchCandidates>>);
    const { user, box } = await openAndType('bob');
    expect(await screen.findByText(/type a full email/i)).toBeInTheDocument();
    const option = await screen.findByRole('option', { name: /bob builder/i });
    expect(fetchCandidatesMock).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'bob', limit: 5, includeIgnored: true })
    );
    expect(fetchLookupMock).not.toHaveBeenCalled();
    await user.click(option);
    expect(box).toHaveValue('bob@x.com');
    await waitFor(() => expect(fetchLookupMock).toHaveBeenCalledWith('bob@x.com'));
  });

  it('renders the CANDIDATE verdict with details and drafts, and opens the pending draft', async () => {
    fetchLookupMock.mockResolvedValue({
      success: true,
      data: base({
        verdict: 'CANDIDATE',
        summary: 'Candidate (Interested) for Senior Engineer — via ethan@',
        candidate: {
          id: 'cand-1',
          name: 'Bob Builder',
          email: 'bob@x.com',
          status: 'INTERESTED',
          role: 'Senior Engineer',
          company: null,
          title: null,
          mailbox: { id: 'mb-e', emailAddress: 'ethan@archive.com' },
          firstMailbox: { id: 'mb-p', emailAddress: 'paul.b@archive.com' },
          repliedAt: null,
          lastInboundAt: '2026-10-05T10:00:00.000Z',
          lastOutboundAt: null,
          createdAt: '2026-10-05T10:00:00.000Z',
        },
        messages: {
          inbound: 2,
          outbound: 1,
          firstAt: '2026-10-03T10:00:00.000Z',
          lastAt: '2026-10-05T10:00:00.000Z',
          latestSubject: 'Re: Role at Archive',
          latestThreadId: 't-1',
          mailboxes: [{ id: 'mb-e', emailAddress: 'ethan@archive.com' }],
          truncated: false,
        },
        drafts: {
          total: 2,
          byStatus: { PENDING: 1, SENT: 1 },
          latest: { id: 'd-9', status: 'PENDING', threadId: 't-1', createdAt: '2026-10-06T00:00:00.000Z' },
        },
      }),
    });
    const { user } = await openAndType('bob@x.com');
    expect(await screen.findByText('Candidate', { selector: '[data-verdict]' })).toBeInTheDocument();
    expect(screen.getByText('Candidate (Interested) for Senior Engineer — via ethan@')).toBeInTheDocument();
    expect(screen.getByText('Bob Builder')).toBeInTheDocument();
    expect(screen.getByText('paul.b@archive.com')).toBeInTheDocument();
    expect(screen.getByText(/2 in · 1 out/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/i)).toBeInTheDocument();
    expect(screen.getByTestId('lookup-integrations')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open conversation/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/inbox?draftId=d-9');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opens Candidates filtered by email when there is no pending draft', async () => {
    fetchLookupMock.mockResolvedValue({
      success: true,
      data: base({
        verdict: 'CANDIDATE',
        summary: 'Candidate (Neutral)',
        candidate: {
          id: 'cand-1', name: 'Bob', email: 'bob@x.com', status: 'NEUTRAL', role: null,
          company: null, title: null, mailbox: null, firstMailbox: null, repliedAt: null,
          lastInboundAt: null, lastOutboundAt: null, createdAt: '2026-10-05T10:00:00.000Z',
        },
      }),
    });
    const { user } = await openAndType('bob@x.com');
    await user.click(await screen.findByRole('button', { name: /open conversation/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/candidates?q=bob%40x.com');
  });

  it.each([
    ['CONTACTED_NO_REPLY', 'Contacted, no reply', 'We emailed them from paul.b@ on 3 Oct — no reply yet'],
    ['REPLIED_NOT_CANDIDATE', 'Replied, not a candidate', 'They wrote to ethan@ on 5 Oct — skipped as not recruiting-related'],
    ['UNKNOWN', 'Unknown', 'No trace of this email in any connected mailbox'],
  ] as const)('renders the %s verdict', async (verdict, label, summary) => {
    fetchLookupMock.mockResolvedValue({ success: true, data: base({ verdict, summary }) });
    await openAndType('bob@x.com');
    expect(await screen.findByText(label, { selector: '[data-verdict]' })).toBeInTheDocument();
    expect(screen.getByText(summary)).toBeInTheDocument();
    // no candidate → nothing to open
    expect(screen.queryByRole('button', { name: /open conversation/i })).not.toBeInTheDocument();
  });

  it('shows an error message when the lookup fails', async () => {
    fetchLookupMock.mockRejectedValue(new Error('boom'));
    await openAndType('bob@x.com');
    expect(await screen.findByText(/lookup failed/i)).toBeInTheDocument();
  });
});
