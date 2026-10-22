import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../../src/lib/api';
import type { Candidate, EmailDraft, EmailMessage, EmailThread } from '../../../src/lib/api';
import { resetLeverAutoRefreshForTests } from '../../../src/lib/leverAutoRefresh';
import * as toast from '../../../src/lib/toast';
import { ago, CANDIDATES, listResponse, location, renderCandidates } from './harness';

vi.mock('../../../src/lib/toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/lib/toast')>()),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchCandidate: vi.fn(),
  updateCandidate: vi.fn(),
  ignoreCandidate: vi.fn(),
  unignoreCandidate: vi.fn(),
  clearRepliedAt: vi.fn(),
  generateDraftForThread: vi.fn(),
  bulkUpdateCandidates: vi.fn(),
  fetchSavedViews: vi.fn(),
  createSavedView: vi.fn(),
  updateSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
  refreshCandidateLever: vi.fn(),
}));

vi.mock('../../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn().mockResolvedValue({ configured: true, createEnabled: true, appEmail: 'rae@archive.com', leverUser: { id: 'lu', name: 'Rae' } }),
  fetchLeverPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverGemPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverPostings: vi.fn().mockReturnValue(new Promise(() => {})),
}));

const msg = (id: string, from: string, h: number, body: string, subject = 'Founding Engineer at Archive'): EmailMessage =>
  ({ id, threadId: 't', mailboxId: 'mb-1', externalMessageId: id, fromAddress: from, fromName: from.split('@')[0], toAddresses: [], subject, bodyText: body, receivedAt: ago(h), headers: {}, createdAt: ago(h) }) as EmailMessage;
const draft = (id: string, status: EmailDraft['status'], h: number) => ({ id, status, createdAt: ago(h) }) as EmailDraft;

function detail(threads: EmailThread[]): Candidate {
  return { ...CANDIDATES[0]!, threads };
}

const TWO_THREADS = [
  {
    id: 't1',
    subject: 'Founding Engineer at Archive',
    messages: [msg('m1', 'rae@archive.com', 90, 'Hi Ada, interested in a chat?'), msg('m2', 'ada@example.com', 2, 'Yes — next week works.')],
    drafts: [draft('d-live', 'PENDING', 1)],
  },
  {
    id: 't0',
    subject: 'Older outreach',
    messages: [msg('m0', 'talent@archive.com', 400, 'Hi Ada — earlier role.', 'Older outreach')],
    drafts: [draft('d-old', 'SENT', 380)],
  },
] as EmailThread[];

beforeEach(() => {
  resetLeverAutoRefreshForTests();
  vi.mocked(api.fetchCandidates).mockResolvedValue(listResponse());
  vi.mocked(api.fetchSavedViews).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.refreshCandidateLever).mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<CandidateSheet /> (side panel)', () => {
  it('shows every thread, not only the latest', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(TWO_THREADS) });
    renderCandidates('/candidates?candidate=c1');
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getAllByTestId('sheet-thread')).toHaveLength(2));
    expect(within(sheet).getByText('Conversations (2)')).toBeInTheDocument();
    expect(within(sheet).getByText('Yes — next week works.')).toBeInTheDocument();
    expect(within(sheet).getByText('Hi Ada — earlier role.')).toBeInTheDocument();
    expect(api.fetchCandidate).toHaveBeenCalledWith('c1');
  });

  it('lists past outreach (our messages, oldest first)', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(TWO_THREADS) });
    renderCandidates('/candidates?candidate=c1');
    const sheet = await screen.findByRole('dialog');
    const outreach = await within(sheet).findByRole('region', { name: 'Past outreach' });
    const items = within(outreach).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Older outreach'),
      expect.stringContaining('Founding Engineer at Archive'),
    ]);
    expect(within(outreach).queryByText(/ada@example.com/)).toBeNull();
  });

  it('has the same Lever section as the Inbox reply pane', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(TWO_THREADS) });
    renderCandidates('/candidates?candidate=c1');
    const sheet = await screen.findByRole('dialog');
    const lever = await within(sheet).findByRole('group', { name: 'Lever' });
    expect(within(lever).getByText('Founding Engineer · Phone Screen')).toBeInTheDocument();
    expect(within(lever).getByRole('link', { name: /Open in Lever/ })).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp-1');
    expect(within(lever).getByRole('button', { name: 'Refresh Lever status' })).toBeInTheDocument();
    expect(await within(lever).findByRole('button', { name: 'Add to another job' })).toBeInTheDocument();
  });

  it('"Open in Inbox" links to the pending reply, keeping the mailbox filter', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(TWO_THREADS) });
    renderCandidates('/candidates?candidate=c1&mailboxId=mb-1');
    const sheet = await screen.findByRole('dialog');
    expect(await within(sheet).findByRole('link', { name: 'Open in Inbox' })).toHaveAttribute('href', '/inbox?mailboxId=mb-1&item=d-live');
  });

  it('no "Open in Inbox" when nothing is waiting', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({
      success: true,
      data: detail([{ ...TWO_THREADS[0]!, drafts: [draft('d1', 'SENT', 1)] }]),
    });
    renderCandidates('/candidates?candidate=c1');
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText('Conversation');
    expect(within(sheet).queryByRole('link', { name: 'Open in Inbox' })).toBeNull();
    // …and the thread offers to write one.
    expect(within(sheet).getByRole('button', { name: 'Generate draft' })).toBeInTheDocument();
  });

  it('shows the reply label, role and mailbox in the header', async () => {
    vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(TWO_THREADS) });
    renderCandidates('/candidates?candidate=c1');
    const sheet = await screen.findByRole('dialog');
    await within(sheet).findByText('Conversations (2)');
    expect(within(sheet).getByTestId('reply-label')).toHaveTextContent('Interested');
    // The shared Inbox RoleChip (H7).
    expect(within(sheet).getByTestId('role-chip')).toHaveAttribute('aria-label', 'Role: Founding Engineer');
    // The shared Inbox MailboxChip: the full sending address.
    expect(within(sheet).getByTestId('mailbox-chip')).toHaveTextContent('rae@archive.com');
  });

  describe('Generate draft (U2a)', () => {
    const NO_DRAFT = [{ ...TWO_THREADS[0]!, drafts: [draft('d1', 'SENT', 1)] }];

    it('says "Draft ready" with a "Review in Inbox" action that opens the new draft', async () => {
      vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(NO_DRAFT) });
      vi.mocked(api.generateDraftForThread).mockResolvedValue({ success: true, data: { id: 'd-new' } as EmailDraft });
      renderCandidates('/candidates?candidate=c1&mailboxId=mb-1');
      const sheet = await screen.findByRole('dialog');
      await userEvent.click(await within(sheet).findByRole('button', { name: 'Generate draft' }));
      await waitFor(() => expect(toast.toastSuccess).toHaveBeenCalled());
      const [title, , action] = vi.mocked(toast.toastSuccess).mock.calls[0]!;
      expect(title).toBe('Draft ready');
      expect(action?.label).toBe('Review in Inbox');
      action!.onClick();
      await waitFor(() => expect(location.current).toBe('/inbox?mailboxId=mb-1&item=d-new'));
    });

    it('on failure shows an error toast with Retry that generates again', async () => {
      vi.mocked(api.fetchCandidate).mockResolvedValue({ success: true, data: detail(NO_DRAFT) });
      vi.mocked(api.generateDraftForThread).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({
        success: true,
        data: { id: 'd-2' } as EmailDraft,
      });
      renderCandidates('/candidates?candidate=c1');
      const sheet = await screen.findByRole('dialog');
      await userEvent.click(await within(sheet).findByRole('button', { name: 'Generate draft' }));
      await waitFor(() => expect(toast.toastError).toHaveBeenCalled());
      const [title, , action] = vi.mocked(toast.toastError).mock.calls[0]!;
      expect(title).toBe("Couldn't generate a draft");
      expect(action?.label).toBe('Retry');
      action!.onClick();
      await waitFor(() => expect(api.generateDraftForThread).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(toast.toastSuccess).toHaveBeenCalledWith('Draft ready', expect.any(String), expect.anything()));
    });
  });

  it('auto-refreshes never-checked Lever rows once (H1)', async () => {
    vi.mocked(api.fetchCandidate).mockReturnValue(new Promise(() => {}));
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await waitFor(() => expect(vi.mocked(api.refreshCandidateLever).mock.calls).toEqual([['c4']]));
  });
});
