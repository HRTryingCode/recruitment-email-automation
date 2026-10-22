// F4: changing a draft's CC from the review pane.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailDrafts from '../../src/components/EmailDrafts';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import type { EmailDraft } from '../../src/lib/api';
import * as api from '../../src/lib/api';
import * as toast from '../../src/lib/toast';

vi.mock('../../src/lib/api', () => ({
  fetchDrafts: vi.fn(),
  approveDraft: vi.fn(),
  discardDraft: vi.fn(),
  sendDraft: vi.fn(),
  updateDraft: vi.fn(),
  regenerateDraft: vi.fn(),
  fetchDraftCcOptions: vi.fn(),
}));
vi.mock('../../src/lib/toast', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/toast')>('../../src/lib/toast');
  return { ...actual, toastSuccess: vi.fn(), toastWarning: vi.fn(), toastError: vi.fn() };
});

const fetchDraftsMock = vi.mocked(api.fetchDrafts);
const updateDraftMock = vi.mocked(api.updateDraft);
const fetchOptionsMock = vi.mocked(api.fetchDraftCcOptions);

const LOOP_SOFIA = "I'm looping in Sofia from the recruitment team here, who will coordinate timing for the interview.";
const LOOP_CATALINA = "I'm looping in Catalina from the recruitment team here, who will coordinate timing for the interview.";

const DRAFT: EmailDraft = {
  id: 'draft-1',
  threadId: 'thread-1',
  subject: 'Re: role',
  bodyText: `Hi Ada,\n\n${LOOP_SOFIA}\n\nBest,`,
  bodyHtml: `<p>${LOOP_SOFIA}</p>`,
  classification: 'INTERESTED',
  confidence: 0.9,
  status: 'PENDING',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ccAddress: 'sofia@archive.com',
  ccEmail: 'sofia@archive.com',
  thread: {
    id: 'thread-1',
    mailboxId: 'mb-1',
    externalThreadId: 'ext-1',
    subject: 'Re: role',
    lastMessageAt: '2026-10-01T00:00:00Z',
    createdAt: '2026-10-01T00:00:00Z',
    candidate: { id: 'cand-1', name: 'Ada Lovelace', email: 'ada@example.com', status: 'INTERESTED' },
  },
};

function renderDrafts() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <EmailDrafts />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openPaneAndPick(optionName: RegExp | string) {
  const user = userEvent.setup();
  renderDrafts();
  fireEvent.click((await screen.findByText('Ada Lovelace')).closest('button')!);
  const pane = await screen.findByRole('dialog');
  const trigger = within(pane).getByRole('combobox', { name: /cc/i });
  await waitFor(() => expect(trigger).toHaveTextContent('Sofia Delgado'));
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: optionName }));
  return { pane, trigger };
}

// Server state: list refetches after the PATCH return whatever it stored.
let serverDraft: EmailDraft = DRAFT;
function patchResponds(response: Awaited<ReturnType<typeof api.updateDraft>>) {
  updateDraftMock.mockImplementation(async () => {
    serverDraft = response.data;
    return response;
  });
}

describe('<EmailDrafts /> CC selector (F4)', () => {
  beforeEach(() => {
    serverDraft = DRAFT;
    fetchDraftsMock.mockImplementation(async () => ({
      success: true,
      data: [serverDraft],
      meta: { total: 1, page: 1, limit: 50 },
    }));
    fetchOptionsMock.mockResolvedValue({
      success: true,
      data: [
        { email: null, name: 'No CC', firstName: null },
        { email: 'catalina.roman@archive.com', name: 'Catalina Roman', firstName: 'Catalina' },
        { email: 'sofia@archive.com', name: 'Sofia Delgado', firstName: 'Sofia' },
      ],
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('PATCHes the new CC, toasts, and refreshes the body', async () => {
    patchResponds({
      success: true,
      data: { ...DRAFT, ccEmail: 'catalina.roman@archive.com', ccAddress: 'catalina.roman@archive.com', bodyText: `Hi Ada,\n\n${LOOP_CATALINA}\n\nBest,`, bodyHtml: `<p>${LOOP_CATALINA}</p>` },
      ccChange: { ccAddress: 'catalina.roman@archive.com', firstName: 'Catalina', loopIn: 'updated', handoffWithoutCc: false },
    });
    const { pane, trigger } = await openPaneAndPick(/Catalina Roman/);

    expect(updateDraftMock).toHaveBeenCalledWith('draft-1', { ccEmail: 'catalina.roman@archive.com' });
    await waitFor(() => expect(toast.toastSuccess).toHaveBeenCalledWith('CC changed to Catalina'));
    expect(trigger).toHaveTextContent('Catalina Roman');
    await waitFor(() => {
      const iframe = within(pane).getByTitle('Draft preview') as HTMLIFrameElement;
      expect(iframe.getAttribute('srcdoc')).toContain('looping in Catalina');
    });
    expect(toast.toastWarning).not.toHaveBeenCalled();
  });

  it('asks the recruiter to fix the name by hand when the loop-in was reworded', async () => {
    patchResponds({
      success: true,
      data: { ...DRAFT, ccEmail: 'catalina.roman@archive.com', ccAddress: 'catalina.roman@archive.com' },
      ccChange: { ccAddress: 'catalina.roman@archive.com', firstName: 'Catalina', loopIn: 'not_found', handoffWithoutCc: false },
    });
    await openPaneAndPick(/Catalina Roman/);
    await waitFor(() =>
      expect(toast.toastWarning).toHaveBeenCalledWith(
        "Update the name in the email body — we couldn't do it automatically"
      )
    );
  });

  it('warns when a hand-off draft is set to No CC', async () => {
    patchResponds({
      success: true,
      data: { ...DRAFT, ccEmail: '', ccAddress: null },
      ccChange: { ccAddress: null, firstName: null, loopIn: 'not_handoff', handoffWithoutCc: true },
    });
    const { pane } = await openPaneAndPick('No CC');
    expect(updateDraftMock).toHaveBeenCalledWith('draft-1', { ccEmail: null });
    await waitFor(() => expect(toast.toastWarning).toHaveBeenCalled());
    expect(within(pane).getByText(/still says you're looping someone in/i)).toBeInTheDocument();
  });

  it('rolls back the optimistic CC when the PATCH fails', async () => {
    updateDraftMock.mockRejectedValue(new Error('nope'));
    const { trigger } = await openPaneAndPick(/Catalina Roman/);
    await waitFor(() => expect(toast.toastError).toHaveBeenCalled());
    await waitFor(() => expect(trigger).toHaveTextContent('Sofia Delgado'));
  });
});
