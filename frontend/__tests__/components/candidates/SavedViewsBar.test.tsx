import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../../../src/lib/api';
import type { SavedView } from '../../../src/lib/api';
import { listResponse, renderCandidates, search } from './harness';

vi.mock('../../../src/lib/api', () => ({
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

vi.mock('../../../src/lib/leverApi', () => ({
  fetchLeverMe: vi.fn().mockResolvedValue({ configured: false, createEnabled: false, appEmail: null, leverUser: null }),
}));

let role = 'recruiter';
vi.mock('../../../src/lib/auth', async (orig) => ({
  ...(await orig<typeof import('../../../src/lib/auth')>()),
  getUser: () => ({ id: 'u1', email: 'rae@archive.com', role }),
}));

const view = (o: Partial<SavedView> & Pick<SavedView, 'id' | 'name' | 'filters'>): SavedView => ({
  userId: 'u1',
  scope: 'candidates',
  shared: false,
  createdAt: '',
  updatedAt: '',
  ...o,
});

const TEAM = view({ id: 'v-team', name: 'Eng pipeline', filters: { status: 'INTERESTED', lever: 'IN' }, userId: null, shared: true });
const MINE = view({ id: 'v-mine', name: 'My unsure', filters: { status: 'NEUTRAL', sort: 'name', dir: 'asc' } });

const lastParams = () => vi.mocked(api.fetchCandidates).mock.calls.at(-1)![0]!;
const views = () => screen.getByRole('group', { name: 'Saved views' });

beforeEach(() => {
  role = 'recruiter';
  vi.mocked(api.fetchCandidates).mockResolvedValue(listResponse());
  vi.mocked(api.fetchSavedViews).mockResolvedValue({ success: true, data: [TEAM, MINE] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('<SavedViewsBar />', () => {
  it('shows the four defaults, then team and personal views; "All active" is on by default', async () => {
    renderCandidates();
    await screen.findByRole('radio', { name: 'Eng pipeline' });
    expect(within(views()).getAllByRole('radio').map((b) => b.textContent)).toEqual([
      'All active',
      'Awaiting your reply',
      'Interested · not in Lever',
      'Needs review',
      'Eng pipeline',
      'My unsure',
    ]);
    expect(within(views()).getByRole('radio', { name: 'All active' })).toHaveAttribute('aria-checked', 'true');
    expect(api.fetchSavedViews).toHaveBeenCalledWith('candidates');
  });

  it.each([
    ['Awaiting your reply', { reply: 'AWAITING_REPLY', view: 'awaiting' }, { replyStatus: 'AWAITING_REPLY' }],
    ['Interested · not in Lever', { status: 'INTERESTED', lever: 'NOT_IN', view: 'interested-not-in-lever' }, { status: 'INTERESTED', lever: 'NOT_IN' }],
    ['Needs review', { status: 'NEEDS_REVIEW', view: 'needs-review' }, { status: 'NEEDS_REVIEW' }],
  ])('"%s" applies its filters to the URL and the request', async (name, url, params) => {
    const user = userEvent.setup();
    renderCandidates();
    await user.click(await screen.findByRole('radio', { name }));
    await waitFor(() => expect(search()).toEqual(url));
    await waitFor(() => expect(lastParams()).toMatchObject(params));
    expect(within(views()).getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
  });

  it('a saved view also applies its sort', async () => {
    const user = userEvent.setup();
    renderCandidates();
    await user.click(await screen.findByRole('radio', { name: 'My unsure' }));
    await waitFor(() => expect(lastParams()).toMatchObject({ status: 'NEUTRAL', sort: 'name', dir: 'asc' }));
  });

  it('"Save view" saves the current filters as a personal view and selects it', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createSavedView).mockResolvedValue({
      success: true,
      data: view({ id: 'v-new', name: 'Not in Lever', filters: { lever: 'NOT_IN' } }),
    });
    renderCandidates('/candidates?lever=NOT_IN');
    await user.click(await screen.findByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Share with the team')).toBeNull();
    await user.type(within(dialog).getByLabelText('Name'), 'Not in Lever');
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
    await waitFor(() =>
      expect(api.createSavedView).toHaveBeenCalledWith({ name: 'Not in Lever', scope: 'candidates', filters: { lever: 'NOT_IN' }, shared: false })
    );
    await waitFor(() => expect(search().view).toBe('v-new'));
  });

  it('admins can share a new view with the team', async () => {
    role = 'admin';
    const user = userEvent.setup();
    vi.mocked(api.createSavedView).mockResolvedValue({ success: true, data: view({ id: 'v2', name: 'Team', filters: {}, shared: true, userId: null }) });
    renderCandidates('/candidates?reply=AWAITING_REPLY&lever=IN');
    await user.click(await screen.findByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Name'), 'Team');
    await user.click(within(dialog).getByLabelText('Share with the team'));
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(api.createSavedView).toHaveBeenCalledWith(expect.objectContaining({ shared: true })));
  });

  it('a personal view can be updated with new filters and deleted', async () => {
    const user = userEvent.setup();
    vi.mocked(api.updateSavedView).mockResolvedValue({ success: true, data: MINE });
    vi.mocked(api.deleteSavedView).mockResolvedValue({ success: true });
    renderCandidates('/candidates?view=v-mine&status=NEUTRAL&lever=IN');
    await user.click(await screen.findByRole('button', { name: 'Manage view My unsure' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Update “My unsure” with these filters' }));
    await waitFor(() => expect(api.updateSavedView).toHaveBeenCalledWith('v-mine', { filters: { status: 'NEUTRAL', lever: 'IN' } }));

    await user.click(screen.getByRole('button', { name: 'Manage view My unsure' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete view' }));
    await waitFor(() => expect(api.deleteSavedView).toHaveBeenCalledWith('v-mine'));
    await waitFor(() => expect(search()).toEqual({ view: 'all' }));
  });

  it('team views are read-only for recruiters', async () => {
    renderCandidates('/candidates?view=v-team&status=INTERESTED&lever=IN');
    await screen.findByRole('radio', { name: 'Eng pipeline' });
    expect(within(views()).getByRole('radio', { name: 'Eng pipeline' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /Manage view/ })).toBeNull();
  });
});
