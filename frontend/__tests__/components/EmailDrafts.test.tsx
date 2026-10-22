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
import { TooltipProvider } from '../../src/components/ui/tooltip';
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
const updateDraftMock = vi.mocked(api.updateDraft);

function makeDraft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    threadId: 'thread-1',
    subject: 'Re: Senior Engineer role',
    bodyText:
      'Hi Ada,\n\nThanks for reaching out — happy to chat next week.',
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
  makeDraft({
    id: 'draft-1',
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
        role: 'Senior Backend Engineer',
      },
    },
  }),
  makeDraft({
    id: 'draft-2',
    subject: 'Re: Staff Engineer opening',
    bodyText: 'Hi Marie,\n\nThanks for getting back to me.',
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
        // role intentionally omitted — should render no pill
      },
    },
  }),
];

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderDrafts(props: { mailboxId?: string } = {}) {
  const client = createClient();
  const tree = (p: { mailboxId?: string }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <TooltipProvider>
          <EmailDrafts {...p} />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree(props));
  return { ...utils, rerenderWith: (p: { mailboxId?: string }) => utils.rerender(tree(p)) };
}

async function openFirstDraft() {
  // The first list row is rendered as a button containing the candidate name.
  const row = (await screen.findByText('Ada Lovelace')).closest('button');
  expect(row).not.toBeNull();
  fireEvent.click(row!);
  // Pane (role=dialog) appears
  return await screen.findByRole('dialog');
}

function getPane(): HTMLElement {
  return screen.getByRole('dialog');
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
    window.sessionStorage.clear();
  });

  it('renders a flat list row for each draft fixture', async () => {
    renderDrafts();
    expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Marie Curie')).toBeInTheDocument();
    expect(screen.getByText('Re: Senior Engineer role')).toBeInTheDocument();
    expect(screen.getByText('Re: Staff Engineer opening')).toBeInTheDocument();
  });

  it('renders the role pill next to the candidate with a role and omits it when missing', async () => {
    renderDrafts();
    await screen.findByText('Ada Lovelace');

    // Ada has a role — pill should render with the role text.
    const adaRow = screen.getByText('Ada Lovelace').closest('button');
    expect(adaRow).not.toBeNull();
    const adaPill = within(adaRow!).getByTestId('role-pill');
    expect(adaPill).toHaveTextContent('Senior Backend Engineer');

    // Marie has no role — no role-pill in her row.
    const marieRow = screen.getByText('Marie Curie').closest('button');
    expect(marieRow).not.toBeNull();
    expect(within(marieRow!).queryByTestId('role-pill')).toBeNull();
  });

  it('clicking a row opens the side-pane with the draft body', async () => {
    const pane = await (async () => {
      renderDrafts();
      return openFirstDraft();
    })();

    // The pane header surfaces the candidate name + email.
    expect(within(pane).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(pane).getByText('ada@example.com')).toBeInTheDocument();

    // The original message block is visible.
    expect(within(pane).getByText(/original message/i)).toBeInTheDocument();
    expect(
      within(pane).getByText(/Hello — yes, very interested\./)
    ).toBeInTheDocument();

    // The draft body is also visible in the pane.
    expect(
      within(pane).getByText(/happy to chat next week/i)
    ).toBeInTheDocument();
  });

  it('clicking Approve inside the pane invokes the approveDraft mutation with the right id', async () => {
    renderDrafts();
    const pane = await openFirstDraft();

    const approveBtn = within(pane).getByRole('button', {
      name: /^approve draft$/i,
    });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(approveDraftMock).toHaveBeenCalled();
    });
    expect(approveDraftMock.mock.calls[0][0]).toBe('draft-1');
  });

  it('clicking Discard inside the pane and confirming invokes the discardDraft mutation', async () => {
    const user = userEvent.setup();
    renderDrafts();
    const pane = await openFirstDraft();

    const discardBtn = within(pane).getByRole('button', {
      name: /^discard draft$/i,
    });
    await user.click(discardBtn);

    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', {
      name: /^discard draft$/i,
    });
    await user.click(confirm);

    await waitFor(() => {
      expect(discardDraftMock).toHaveBeenCalled();
    });
    expect(discardDraftMock.mock.calls[0][0]).toBe('draft-1');
  });

  it('clicking Regenerate inside the pane shows the spinning state while the mutation is in-flight', async () => {
    let resolveRegenerate: (value: unknown) => void = () => {};
    regenerateDraftMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRegenerate = resolve;
        }) as Promise<{ success: true; data: EmailDraft }>
    );

    const user = userEvent.setup();
    const { container } = renderDrafts();
    const pane = await openFirstDraft();

    const regenerateBtn = within(pane).getByRole('button', {
      name: /regenerate draft/i,
    });
    await user.click(regenerateBtn);

    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).not.toBeNull();
    });
    expect(regenerateBtn).toBeDisabled();

    resolveRegenerate({ success: true, data: makeDraft({ id: 'draft-1' }) });
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
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

  // --- Keyboard shortcuts -------------------------------------------------

  it('pressing "a" with the pane open approves the draft', async () => {
    renderDrafts();
    await openFirstDraft();

    // Ensure focus is on the body element so the global keydown listener fires
    document.body.focus();
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      expect(approveDraftMock).toHaveBeenCalled();
    });
    expect(approveDraftMock.mock.calls[0][0]).toBe('draft-1');
  });

  it('pressing Escape closes the side-pane', async () => {
    renderDrafts();
    await openFirstDraft();
    expect(getPane()).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  // --- Audit B5 -----------------------------------------------------------

  it('saving an edit sends the edited text (with signature) and the preview shows the saved HTML (C1)', async () => {
    const SIG = 'Aaron Rampersad\nArchive';
    const withSig = makeDraft({
      bodyText: `Hi Ada,\n\nOriginal AI text.\n\nBest,\n${SIG}`,
      bodyHtml: '<div>Original AI text.</div><div class="sig">Aaron Rampersad</div>',
    });
    // Server state: the list refetch after save returns whatever PATCH stored.
    let serverDraft: EmailDraft = withSig;
    fetchDraftsMock.mockImplementation(async () => ({
      success: true,
      data: [serverDraft],
      meta: { total: 1, page: 1, limit: 50 },
    }));
    updateDraftMock.mockImplementation(async () => {
      serverDraft = {
        ...withSig,
        bodyText: `Hi Ada,\n\nRecruiter edit.\n\nBest,\n${SIG}`,
        bodyHtml: '<div>Recruiter edit.</div><div class="sig">Aaron Rampersad</div>',
        updatedAt: '2026-05-20T12:00:00.000Z',
      };
      return { success: true, data: serverDraft };
    });
    const user = userEvent.setup();
    renderDrafts();
    const pane = await openFirstDraft();

    await user.click(within(pane).getByRole('button', { name: /edit/i }));
    const textarea = within(pane).getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, `Hi Ada,{enter}{enter}Recruiter edit.{enter}{enter}Best,{enter}Aaron Rampersad{enter}Archive`);
    await user.click(within(pane).getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateDraftMock).toHaveBeenCalled());
    expect(updateDraftMock).toHaveBeenCalledWith('draft-1', {
      bodyText: `Hi Ada,\n\nRecruiter edit.\n\nBest,\n${SIG}`,
    });
    await waitFor(() => {
      const iframe = within(getPane()).getByTitle('Draft preview') as HTMLIFrameElement;
      expect(iframe.getAttribute('srcdoc')).toContain('Recruiter edit.');
      expect(iframe.getAttribute('srcdoc')).toContain('class="sig"');
    });
  });

  it('pressing Enter on a focused button activates that button, not the open-draft shortcut (M21)', async () => {
    renderDrafts();
    await screen.findByText('Ada Lovelace');
    const helpBtn = screen.getByRole('button', { name: /show keyboard shortcuts/i });
    helpBtn.focus();
    fireEvent.keyDown(helpBtn, { key: 'Enter' });
    expect(screen.queryByRole('dialog', { name: /draft for/i })).not.toBeInTheDocument();
  });

  it('pressing "a" with the pane closed does not approve anything (M21)', async () => {
    renderDrafts();
    await screen.findByText('Ada Lovelace');
    fireEvent.keyDown(window, { key: 'a' });
    await new Promise((r) => setTimeout(r, 20));
    expect(approveDraftMock).not.toHaveBeenCalled();
  });

  it('refetches with the selected mailbox and resets to page 1 when it changes (M22)', async () => {
    const { rerenderWith } = renderDrafts({ mailboxId: 'mb-1' });
    await screen.findByText('Ada Lovelace');
    expect(fetchDraftsMock).toHaveBeenCalledWith(expect.objectContaining({ mailboxId: 'mb-1', page: 1 }));
    rerenderWith({ mailboxId: 'mb-2' });
    await waitFor(() =>
      expect(fetchDraftsMock).toHaveBeenCalledWith(expect.objectContaining({ mailboxId: 'mb-2', page: 1 }))
    );
  });

  it('paginates: Next loads page 2 when there are more drafts than one page (M22)', async () => {
    fetchDraftsMock.mockResolvedValue({ success: true, data: DRAFTS, meta: { total: 120, page: 1, limit: 50 } });
    const user = userEvent.setup();
    renderDrafts();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() =>
      expect(fetchDraftsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', page: 2 }))
    );
  });

  it('the Expired tab lists PENDING drafts older than the expiry window (M16)', async () => {
    const user = userEvent.setup();
    renderDrafts();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /^expired$/i }));
    await waitFor(() =>
      expect(fetchDraftsMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', expired: true }))
    );
  });

  it('shows the CC address served by the API instead of a hardcoded one (L17)', async () => {
    fetchDraftsMock.mockResolvedValue({
      success: true,
      data: [makeDraft({ ccAddress: 'maria@archive.com' })],
      meta: { total: 1, page: 1, limit: 50 },
    });
    renderDrafts();
    const pane = await openFirstDraft();
    expect(within(pane).getByText('maria@archive.com')).toBeInTheDocument();
    expect(within(pane).queryByText('sofia@archive.com')).not.toBeInTheDocument();
  });

  it('restores unsaved edits after the pane is closed and reopened (L17)', async () => {
    const user = userEvent.setup();
    renderDrafts();
    let pane = await openFirstDraft();
    await user.click(within(pane).getByRole('button', { name: /edit/i }));
    const textarea = within(pane).getByRole('textbox');
    await user.clear(textarea);
    await user.type(textarea, 'Half-written reply');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    pane = await openFirstDraft();
    expect(within(pane).getByRole('textbox')).toHaveValue('Half-written reply');
  });
});
