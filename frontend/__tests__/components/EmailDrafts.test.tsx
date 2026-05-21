import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailDrafts from '../../src/components/EmailDrafts';
import type { EmailDraft } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchDrafts: vi.fn(),
  approveDraft: vi.fn(),
  discardDraft: vi.fn(),
  sendDraft: vi.fn(),
  updateDraft: vi.fn(),
  regenerateDraft: vi.fn(),
}));

const fetchDraftsMock = vi.mocked(api.fetchDrafts);
const approveDraftMock = vi.mocked(api.approveDraft);
const discardDraftMock = vi.mocked(api.discardDraft);
const regenerateDraftMock = vi.mocked(api.regenerateDraft);

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    threadId: 'thread-1',
    subject: 'Re: Senior Engineer role',
    bodyText: 'Hi Ada,\n\nThanks for reaching out — happy to chat next week.',
    classification: 'INTERESTED',
    confidence: 0.92,
    status: 'PENDING',
    createdAt: '2026-05-20T11:00:00.000Z',
    updatedAt: '2026-05-20T11:00:00.000Z',
    thread: {
      id: 'thread-1',
      mailboxId: 'mb-1',
      externalThreadId: 'ext-1',
      subject: 'Re: Senior Engineer role',
      lastMessageAt: '2026-05-20T10:00:00.000Z',
      createdAt: '2026-05-19T10:00:00.000Z',
      candidate: {
        id: 'cand-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        status: 'INTERESTED',
      },
    },
    originalMessage: {
      id: 'msg-orig',
      fromAddress: 'ada@example.com',
      fromName: 'Ada Lovelace',
      subject: 'Re: Senior Engineer role',
      bodyText: 'Hello — yes, very interested. When works for a chat?',
      bodyHtml: null,
      receivedAt: '2026-05-19T08:30:00.000Z',
    },
    ...overrides,
  };
}

const DRAFTS: EmailDraft[] = [
  makeDraft({ id: 'draft-1' }),
  makeDraft({
    id: 'draft-2',
    subject: 'Re: Staff Engineer opening',
    bodyText: 'Hi Marie,\n\nThanks!',
    thread: {
      id: 'thread-2',
      mailboxId: 'mb-1',
      externalThreadId: 'ext-2',
      subject: 'Re: Staff Engineer opening',
      lastMessageAt: '2026-05-20T09:00:00.000Z',
      createdAt: '2026-05-19T09:00:00.000Z',
      candidate: {
        id: 'cand-2',
        name: 'Marie Curie',
        email: 'marie@example.com',
        status: 'INTERESTED',
      },
    },
  }),
];

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderDrafts() {
  const client = createClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <EmailDrafts />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('<EmailDrafts />', () => {
  beforeEach(() => {
    fetchDraftsMock.mockResolvedValue({
      success: true,
      data: DRAFTS,
      meta: { total: DRAFTS.length, page: 1, limit: 100 },
    });
    approveDraftMock.mockResolvedValue({ success: true, message: 'ok' });
    discardDraftMock.mockResolvedValue({ success: true, message: 'ok' });
    regenerateDraftMock.mockResolvedValue({
      success: true,
      data: makeDraft({ id: 'draft-1' }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders a draft card for each draft fixture', async () => {
    renderDrafts();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Marie Curie')).toBeInTheDocument();
    expect(
      screen.getByText('Re: Senior Engineer role')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Re: Staff Engineer opening')
    ).toBeInTheDocument();
  });

  it('clicking Approve invokes the approveDraft mutation with the right id', async () => {
    renderDrafts();

    await screen.findByText('Ada Lovelace');
    const approveButtons = screen.getAllByRole('button', {
      name: /^approve draft$/i,
    });
    fireEvent.click(approveButtons[0]);

    // React Query v5 calls `mutationFn(variables, context)` — when the
    // component passes the api function directly we receive both, so
    // assert against the first argument only.
    await waitFor(() => {
      expect(approveDraftMock).toHaveBeenCalled();
    });
    expect(approveDraftMock.mock.calls[0][0]).toBe('draft-1');
  });

  it('clicking Discard + confirming invokes the discardDraft mutation', async () => {
    const user = userEvent.setup();
    renderDrafts();

    await screen.findByText('Ada Lovelace');
    const discardButtons = screen.getAllByRole('button', {
      name: /^discard draft$/i,
    });
    await user.click(discardButtons[0]);

    // The trigger and the confirm button share an accessible name; scope
    // to the alertdialog Radix portals to <body>.
    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: /^discard draft$/i,
    });
    await user.click(confirm);

    // mutationFn is passed directly to useMutation, so React Query passes
    // a context object as a second argument; verify only the first arg.
    await waitFor(() => {
      expect(discardDraftMock).toHaveBeenCalled();
    });
    expect(discardDraftMock.mock.calls[0][0]).toBe('draft-1');
  });

  it('clicking Regenerate shows the spinning loading state while the mutation is in-flight', async () => {
    let resolveRegenerate: (value: unknown) => void = () => {};
    regenerateDraftMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegenerate = resolve;
        }) as Promise<{ success: true; data: EmailDraft }>
    );

    const user = userEvent.setup();
    const { container } = renderDrafts();

    await screen.findByText('Ada Lovelace');
    const regenerateButtons = screen.getAllByLabelText(/regenerate draft/i);
    await user.click(regenerateButtons[0]);

    // While the mutation is pending, the RefreshCw icon gets `animate-spin`.
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).not.toBeNull();
    });
    // And the regenerate trigger is disabled.
    expect(regenerateButtons[0]).toBeDisabled();

    // Resolve the mutation; the spinning state should clear.
    resolveRegenerate({ success: true, data: makeDraft({ id: 'draft-1' }) });
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
  });

  it('renders the Original message block inside the expanded card', async () => {
    const user = userEvent.setup();
    renderDrafts();

    // The card is collapsed by default; click the header to expand.
    const adaName = await screen.findByText('Ada Lovelace');
    const card = adaName.closest('div.group')!;
    const header = within(card as HTMLElement).getByText(
      'Re: Senior Engineer role'
    );
    await user.click(header);

    // Once expanded, the OriginalMessageBlock renders the labeled headers
    // and the original message body.
    expect(
      await screen.findByText(/original message/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Ada Lovelace <ada@example.com>/)).toBeInTheDocument();
    expect(
      screen.getByText(/Hello — yes, very interested\./)
    ).toBeInTheDocument();
  });

  it('switching status tabs refetches drafts for the selected status', async () => {
    const user = userEvent.setup();
    renderDrafts();

    await screen.findByText('Ada Lovelace');

    expect(fetchDraftsMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING' })
    );

    fetchDraftsMock.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 100 },
    });
    await user.click(screen.getByRole('button', { name: /^sent$/i }));

    await waitFor(() => {
      expect(fetchDraftsMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'SENT' })
      );
    });

    fetchDraftsMock.mockResolvedValueOnce({
      success: true,
      data: [],
      meta: { total: 0, page: 1, limit: 100 },
    });
    await user.click(screen.getByRole('button', { name: /^approved$/i }));

    await waitFor(() => {
      expect(fetchDraftsMock).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'APPROVED' })
      );
    });
  });
});
