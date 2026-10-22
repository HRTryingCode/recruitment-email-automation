import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../src/lib/api';
import * as leverApi from '../../src/lib/leverApi';
import { resetLeverAutoRefreshForTests } from '../../src/lib/leverAutoRefresh';
import { CANDIDATES, listResponse, makeCandidate, renderCandidates, search } from './candidates/harness';

vi.mock('../../src/lib/api', () => ({
  fetchCandidates: vi.fn(),
  fetchCandidate: vi.fn(() => new Promise(() => {})),
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
  refreshCandidateLever: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn().mockResolvedValue({
    configured: true,
    createEnabled: true,
    appEmail: 'rae@archive.com',
    leverUser: { id: 'lu', name: 'Rae' },
  }),
  fetchLeverPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverGemPrefill: vi.fn().mockReturnValue(new Promise(() => {})),
  fetchLeverPostings: vi.fn().mockReturnValue(new Promise(() => {})),
}));

const fetchCandidates = vi.mocked(api.fetchCandidates);
const lastParams = () => fetchCandidates.mock.calls.at(-1)![0]!;
const row = (name: string) => screen.getByText(name).closest('tr')!;

beforeEach(() => {
  resetLeverAutoRefreshForTests();
  fetchCandidates.mockResolvedValue(listResponse());
  vi.mocked(api.fetchSavedViews).mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.updateCandidate).mockResolvedValue({ success: true, data: CANDIDATES[0]! });
  vi.mocked(api.ignoreCandidate).mockResolvedValue({ success: true, data: CANDIDATES[0]! });
  vi.mocked(api.generateDraftForThread).mockResolvedValue({ success: true, data: { id: 'd1' } } as never);
  vi.mocked(api.bulkUpdateCandidates).mockResolvedValue({ success: true, data: { updated: 2, draftsDiscarded: 0 } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<CandidateTable /> columns', () => {
  it('has the approved columns in priority order — Status and Reply merged into one', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    const heads = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim()).filter(Boolean);
    expect(heads).toEqual(['Candidate', 'Reply', 'Lever', 'Role', 'Mailbox', 'Last activity', 'Actions']);
  });

  it('one row per candidate: name with email underneath, reply label in words, Lever chip, role, mailbox', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    const ada = row('Ada Lovelace');
    expect(within(ada).getByText('ada@example.com')).toBeInTheDocument();
    expect(within(ada).getByTestId('reply-label')).toHaveTextContent('Interested');
    expect(within(ada).getByTestId('lever-badge')).toHaveTextContent('Founding Engineer · Phone Screen');
    expect(within(ada).getAllByText('Founding Engineer').length).toBeGreaterThan(0);
    // U2a: the Inbox's MailboxChip and RoleChip, not bare text.
    expect(within(ada).getByTestId('mailbox-chip')).toHaveTextContent('rae@archive.com');
    expect(within(ada).getByTestId('role-chip')).toHaveAttribute('aria-label', 'Role: Founding Engineer');
    expect(within(ada).getByText('2h ago')).toBeInTheDocument();
    expect(within(row('Grace Hopper')).getByTestId('reply-label')).toHaveTextContent('Needs review');
    expect(within(row('Grace Hopper')).getByTestId('role-chip')).toHaveTextContent('Role unknown');
    expect(within(row('Marie Curie')).getByTestId('reply-label')).toHaveTextContent('Not interested');
    expect(within(row('Linus Torvalds')).getByTestId('lever-badge')).toHaveTextContent('Checking Lever…');
  });

  it('never shows more than two status chips in a row (role and mailbox are identity chips)', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    for (const r of screen.getAllByTestId('candidate-row')) {
      const status = [...r.querySelectorAll('[data-slot=badge]')].filter(
        (b) => !b.matches('[data-testid=role-chip], [data-testid=mailbox-chip] *, [data-testid=mailbox-chip]')
      );
      expect(status.length).toBeLessThanOrEqual(2);
    }
  });

  it('last activity is the later of their message and ours, saying who', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    expect(within(row('Ada Lovelace')).getByText(/· them/)).toBeInTheDocument();
    expect(within(row('Marie Curie')).getByText('2d ago')).toBeInTheDocument();
    expect(within(row('Marie Curie')).getByText(/· you/)).toBeInTheDocument();
  });
});

describe('<CandidateTable /> server params, sort and URL state', () => {
  it('asks for active candidates, newest activity first, 50 a page', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    expect(lastParams()).toEqual({ page: 1, limit: 50, includeIgnored: false, sort: 'lastActivity', dir: 'desc' });
  });

  it('sorting a column puts sort/dir in the URL and asks the server (every visible column)', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /^Role/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'role', dir: 'asc' }));
    expect(search()).toMatchObject({ sort: 'role', dir: 'asc' });
    await user.click(screen.getByRole('button', { name: /^Role/ }));
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'role', dir: 'desc' }));
    for (const [label, key] of [
      ['Candidate', 'name'],
      ['Reply', 'status'],
      ['Lever', 'lever'],
      ['Mailbox', 'mailbox'],
    ] as const) {
      await user.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
      await waitFor(() => expect(lastParams()).toMatchObject({ sort: key, dir: 'asc' }));
    }
    // Back to the default (newest activity first): out of the URL, and the
    // first page is answered from the cache.
    await user.click(screen.getByRole('button', { name: /^Last activity/ }));
    await waitFor(() => expect(search().sort).toBeUndefined());
    expect(screen.getByRole('columnheader', { name: /Last activity/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('reads filters, sort and page from the URL', async () => {
    fetchCandidates.mockResolvedValue(listResponse(CANDIDATES, 120));
    renderCandidates('/candidates?status=INTERESTED&lever=NOT_IN&q=ada&sort=mailbox&dir=desc&page=2');
    await screen.findByText('Ada Lovelace');
    expect(lastParams()).toEqual({
      page: 2,
      limit: 50,
      status: 'INTERESTED',
      lever: 'NOT_IN',
      search: 'ada',
      includeIgnored: false,
      sort: 'mailbox',
      dir: 'desc',
    });
  });

  it('rewrites the Today page ?filter= pills to reply/status (M19)', async () => {
    renderCandidates('/candidates?filter=AWAITING_REPLY');
    await screen.findByText('Ada Lovelace');
    await waitFor(() => expect(search()).toEqual({ reply: 'AWAITING_REPLY' }));
    expect(lastParams()).toMatchObject({ replyStatus: 'AWAITING_REPLY' });
  });

  it('pagination footer pages through the server results', async () => {
    const user = userEvent.setup();
    fetchCandidates.mockResolvedValue(listResponse(CANDIDATES, 120));
    renderCandidates();
    const footer = await screen.findByTestId('candidates-pagination-footer');
    expect(footer).toHaveTextContent('Showing 1–50 of 120');
    await user.click(within(footer).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ page: 2 }));
    expect(search().page).toBe('2');
  });

  it('no pagination footer when one page holds everything', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByTestId('candidates-pagination-footer')).toBeNull();
  });
});

describe('<CandidateTable /> filters and search', () => {
  it('a filter shows up as a removable chip', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('combobox', { name: 'Status filter' }));
    await user.click(await screen.findByRole('option', { name: 'Interested' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'INTERESTED' }));
    expect(search().status).toBe('INTERESTED');
    const chips = screen.getByTestId('active-filters');
    await user.click(within(chips).getByRole('button', { name: 'Remove filter Status: Interested' }));
    await waitFor(() => expect(search().status).toBeUndefined());
    expect(screen.queryByTestId('active-filters')).toBeNull();
  });

  it('the Lever filter refetches with lever=IN / NOT_IN', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('combobox', { name: 'Lever filter' }));
    await user.click(await screen.findByRole('option', { name: 'Not in Lever' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ lever: 'NOT_IN' }));
  });

  it('search no longer disables filters: both are sent and both show as chips', async () => {
    const user = userEvent.setup();
    renderCandidates('/candidates?status=INTERESTED');
    await screen.findByText('Ada Lovelace');
    const calls = fetchCandidates.mock.calls.length;
    await user.type(screen.getByRole('textbox', { name: 'Search candidates' }), 'ada');
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'ada', status: 'INTERESTED' }));
    // Debounced: one request for the whole word, not one per keystroke.
    expect(fetchCandidates.mock.calls.length).toBe(calls + 1);
    expect(screen.getByRole('combobox', { name: 'Status filter' })).toBeEnabled();
    const chips = screen.getByTestId('active-filters');
    expect(within(chips).getByText('Status: Interested')).toBeInTheDocument();
    expect(within(chips).getByText('Search: “ada”')).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(search()).toEqual({}));
    expect(screen.getByRole('textbox', { name: 'Search candidates' })).toHaveValue('');
  });

  it('seeds the search from ?q= (old lookup links)', async () => {
    renderCandidates('/candidates?q=grace%40example.com');
    await screen.findByText('Ada Lovelace');
    expect(screen.getByRole('textbox', { name: 'Search candidates' })).toHaveValue('grace@example.com');
    expect(lastParams()).toMatchObject({ search: 'grace@example.com' });
  });
});

describe('<CandidateTable /> row actions', () => {
  it('every row has Open, Copy email and a ⋯ menu; Add to Lever where Lever was checked', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    const marie = row('Marie Curie');
    expect(within(marie).getByRole('button', { name: 'Open' })).toBeInTheDocument();
    expect(within(marie).getByRole('button', { name: 'Copy marie@example.com' })).toBeInTheDocument();
    expect(within(marie).getByRole('button', { name: 'More actions for Marie Curie' })).toBeInTheDocument();
    expect(await within(marie).findByRole('button', { name: 'Add to Lever' })).toBeInTheDocument();
    expect(within(row('Ada Lovelace')).getByRole('button', { name: 'Add to another job' })).toBeInTheDocument();
    expect(within(row('Linus Torvalds')).queryByRole('button', { name: /Add to/ })).toBeNull();
  });

  it('⋯ → Change status writes the status', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(within(row('Marie Curie')).getByRole('button', { name: 'More actions for Marie Curie' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change status' }));
    // jsdom: a pointer move onto a submenu item reads as leaving the 0×0
    // submenu (Radix grace area) and closes it, so click the item directly.
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Unsure' }));
    await waitFor(() => expect(api.updateCandidate).toHaveBeenCalledWith('c3', { status: 'NEUTRAL' }));
  });

  it('⋯ → Ignore… asks first, then goes through the ignore flow (M20)', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(within(row('Marie Curie')).getByRole('button', { name: 'More actions for Marie Curie' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ignore…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Ignore Marie Curie?');
    await user.click(within(dialog).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(api.ignoreCandidate).toHaveBeenCalledWith('c3'));
    expect(api.updateCandidate).not.toHaveBeenCalled();
  });

  it('ignored rows offer Restore instead', async () => {
    const user = userEvent.setup();
    vi.mocked(api.unignoreCandidate).mockResolvedValue({ success: true, data: CANDIDATES[0]! });
    fetchCandidates.mockResolvedValue(listResponse([makeCandidate({ id: 'c9', name: 'Alan Turing', email: 'alan@example.com', status: 'IGNORED' })]));
    renderCandidates('/candidates?status=IGNORED');
    await screen.findByText('Alan Turing');
    expect(within(row('Alan Turing')).getByTestId('reply-label')).toHaveTextContent('Ignored');
    await user.click(screen.getByRole('button', { name: 'More actions for Alan Turing' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(api.unignoreCandidate).toHaveBeenCalledWith('c9'));
  });

  it('NEEDS_REVIEW triage: "Interested + draft reply" sets the status and drafts (M17)', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(within(row('Grace Hopper')).getByRole('button', { name: 'More actions for Grace Hopper' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Interested + draft reply' }));
    await waitFor(() => expect(api.generateDraftForThread).toHaveBeenCalledWith('t2', 'INTERESTED'));
    expect(api.updateCandidate).toHaveBeenCalledWith('c2', { status: 'INTERESTED' });
  });

  it('triage items only appear for NEEDS_REVIEW', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(within(row('Ada Lovelace')).getByRole('button', { name: 'More actions for Ada Lovelace' }));
    await screen.findByRole('menuitem', { name: 'Change status' });
    expect(screen.queryByRole('menuitem', { name: 'Interested + draft reply' })).toBeNull();
  });
});

describe('<CandidateTable /> bulk select', () => {
  it('checking rows shows the bulk bar; change status updates all of them at once', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: 'Select Ada Lovelace' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select Marie Curie' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('2 selected');
    expect(within(bar).queryByRole('button', { name: /Add to Lever/ })).toBeNull();
    await user.click(within(bar).getByRole('combobox', { name: 'Change status of selected' }));
    await user.click(await screen.findByRole('option', { name: 'Not interested' }));
    await waitFor(() => expect(api.bulkUpdateCandidates).toHaveBeenCalledWith(['c1', 'c3'], 'NOT_INTERESTED'));
    await waitFor(() => expect(screen.queryByRole('toolbar', { name: 'Bulk actions' })).toBeNull());
  });

  it('bulk Ignore confirms, then ignores every selected candidate in one call', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
    const bar = screen.getByRole('toolbar', { name: 'Bulk actions' });
    expect(bar).toHaveTextContent('4 selected');
    await user.click(within(bar).getByRole('button', { name: 'Ignore' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Ignore 4 candidates?');
    await user.click(within(dialog).getByRole('button', { name: 'Ignore' }));
    await waitFor(() => expect(api.bulkUpdateCandidates).toHaveBeenCalledWith(['c1', 'c2', 'c3', 'c4'], 'IGNORED'));
  });

  it('the header checkbox goes indeterminate for a partial selection', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('checkbox', { name: 'Select Grace Hopper' }));
    expect(screen.getByRole('checkbox', { name: 'Select all on this page' })).toHaveAttribute('data-state', 'indeterminate');
  });
});

describe('<CandidateTable /> side panel + keyboard', () => {
  it('clicking a name opens the side panel and puts the candidate in the URL', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await user.click(await screen.findByRole('button', { name: 'Grace Hopper' }));
    expect(search().candidate).toBe('c2');
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Grace Hopper' })).toBeInTheDocument();
  });

  it('?candidate= opens the panel on load', async () => {
    renderCandidates('/candidates?candidate=c3');
    const sheet = await screen.findByRole('dialog');
    // The list row fills the header while the full record loads.
    expect(await within(sheet).findByText('marie@example.com')).toBeInTheDocument();
  });

  it('opening a row warms Add to Lever (H5); rows Lever never checked do not', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await user.click(await screen.findByRole('button', { name: 'Linus Torvalds' }));
    expect(leverApi.fetchLeverGemPrefill).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Marie Curie' }));
    await waitFor(() => expect(leverApi.fetchLeverPrefill).toHaveBeenCalledWith({ candidateId: 'c3' }));
  });

  it('↑/↓ move the cursor, x toggles its checkbox, ↵ opens it, Esc closes', async () => {
    renderCandidates();
    await screen.findByText('Ada Lovelace');
    const rows = () => screen.getAllByTestId('candidate-row');
    expect(rows()[0]).toHaveAttribute('data-active', 'true');
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowDown' });
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    expect(rows()[1]).toHaveAttribute('data-active', 'true');
    act(() => {
      fireEvent.keyDown(window, { key: 'x' });
    });
    expect(screen.getByRole('checkbox', { name: 'Select Grace Hopper' })).toHaveAttribute('data-state', 'checked');
    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });
    await waitFor(() => expect(search().candidate).toBe('c2'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(search().candidate).toBeUndefined());
  });
});
