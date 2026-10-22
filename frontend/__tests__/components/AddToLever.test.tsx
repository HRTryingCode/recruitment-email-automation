import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddToLeverButton from '../../src/components/AddToLeverButton';
import AddToLeverDialog from '../../src/components/AddToLeverDialog';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import * as leverApi from '../../src/lib/leverApi';
import type { LeverGemPrefill, LeverPrefill } from '../../src/lib/leverApi';

vi.mock('../../src/lib/leverApi', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/leverApi')>('../../src/lib/leverApi');
  return {
    ...actual,
    fetchLeverMe: vi.fn(),
    fetchLeverPostings: vi.fn(),
    fetchLeverPrefill: vi.fn(),
    fetchLeverGemPrefill: vi.fn(),
    createLeverOpportunity: vi.fn(),
    startGemConnect: vi.fn(),
    fetchGemStatus: vi.fn(),
  };
});

const toast = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('../../src/lib/toast', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/toast')>('../../src/lib/toast');
  return { ...actual, ...toast };
});

const api = vi.mocked(leverApi);

const POSTINGS = {
  postings: [
    { id: 'post-des', title: 'Product Designer', team: 'Design', location: 'Remote', state: 'published' },
    { id: 'post-fe', title: 'Founding Engineer', team: 'Eng', location: 'NYC', state: 'published' },
    { id: 'post-ops', title: 'Ops Lead', team: 'Ops', location: null, state: 'internal' },
  ],
  stages: [
    { id: 'stage-new', text: 'New lead' },
    { id: 'stage-ic', text: 'Interest Call' },
  ],
  defaultStageId: 'stage-ic',
};

function prefill(extra: Partial<LeverPrefill> = {}): LeverPrefill {
  return {
    candidateId: 'c1',
    name: 'Jane Doe',
    email: 'jane@example.com',
    headline: 'Staff Engineer at Acme',
    linkedinUrl: 'https://www.linkedin.com/in/jane',
    suggestedPostingId: 'post-fe',
    stageId: 'stage-ic',
    stageName: 'Interest Call',
    origin: 'sourced',
    sources: ['Gem outreach'],
    tags: ['paul.b'],
    note: 'Added from Recruiting Email Automation by paul.b@archive.com.\n\nLatest reply (2026-10-20):\nSounds great',
    existing: [],
    existingState: 'NOT_FOUND',
    createEnabled: true,
    ...extra,
  };
}

function gemPrefill(extra: Partial<LeverGemPrefill> = {}): LeverGemPrefill {
  return {
    status: 'FOUND',
    source: 'live',
    fetchedAt: '2026-10-22T12:00:00.000Z',
    name: 'Jane Q. Doe',
    headline: 'Staff Engineer at Acme',
    location: 'Berlin',
    phone: '+49 30 1234',
    linkedinUrl: 'https://www.linkedin.com/in/jane',
    resume: { available: true, source: 'LinkedIn PDF', filename: 'Jane_LinkedIn.pdf' },
    ...extra,
  };
}

/** A Gem response the test resolves by hand. */
function deferredGem() {
  let resolve!: (v: LeverGemPrefill) => void;
  const promise = new Promise<LeverGemPrefill>((r) => (resolve = r));
  return { promise, resolve };
}

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  for (const fn of [api.fetchLeverMe, api.fetchLeverPostings, api.fetchLeverPrefill, api.fetchLeverGemPrefill, api.createLeverOpportunity])
    fn.mockReset();
  toast.toastSuccess.mockReset();
  toast.toastError.mockReset();
  api.fetchLeverMe.mockResolvedValue({
    configured: true,
    createEnabled: true,
    appEmail: 'paul.b@archive.com',
    leverUser: { id: 'lu', name: 'Paul' },
  });
  api.fetchLeverPostings.mockResolvedValue(POSTINGS);
  api.fetchLeverPrefill.mockResolvedValue(prefill());
  api.fetchLeverGemPrefill.mockResolvedValue(gemPrefill());
  api.createLeverOpportunity.mockResolvedValue({
    opportunityId: 'opp-new',
    leverUrl: 'https://hire.lever.co/candidates/opp-new',
    postingId: 'post-fe',
    postingTitle: 'Founding Engineer',
    stageName: 'Interest Call',
    resumeAttached: true,
    noteAdded: true,
  });
});

describe('AddToLeverButton', () => {
  it('NOT_FOUND → "Add to Lever"; in Lever → "Add to another job"', async () => {
    const { unmount } = wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    expect(await screen.findByRole('button', { name: 'Add to Lever' })).toBeEnabled();
    unmount();
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever />);
    expect(await screen.findByRole('button', { name: 'Add to another job' })).toBeEnabled();
  });

  it('flag off → disabled with a tooltip explaining why', async () => {
    api.fetchLeverMe.mockResolvedValue({ configured: true, createEnabled: false, appEmail: 'a@archive.com', leverUser: { id: 'x', name: null } });
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    const btn = await screen.findByRole('button', { name: 'Add to Lever' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    await userEvent.hover(btn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add to Lever is turned off');
    await userEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no Lever user → disabled with the "account wasn\'t found" reason', async () => {
    api.fetchLeverMe.mockResolvedValue({ configured: true, createEnabled: true, appEmail: 'new@archive.com', leverUser: null });
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    const btn = await screen.findByRole('button', { name: 'Add to Lever' });
    await userEvent.hover(btn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent("Your Lever account wasn't found for new@archive.com");
  });

  it('Lever not configured (or /me failing) → hidden', async () => {
    api.fetchLeverMe.mockResolvedValue({ configured: false, createEnabled: false, appEmail: null, leverUser: null });
    const { container } = wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    await waitFor(() => expect(api.fetchLeverMe).toHaveBeenCalled());
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens the dialog', async () => {
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Add to Lever' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('hover prefetches the app prefill, Gem and postings before the click; the open reuses them', async () => {
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    const btn = await screen.findByRole('button', { name: 'Add to Lever' });
    expect(api.fetchLeverPrefill).not.toHaveBeenCalled();
    await userEvent.hover(btn);
    await waitFor(() => expect(api.fetchLeverGemPrefill).toHaveBeenCalledWith({ candidateId: 'c1' }));
    expect(api.fetchLeverPrefill).toHaveBeenCalledWith({ candidateId: 'c1' });
    expect(api.fetchLeverPostings).toHaveBeenCalled();
    await userEvent.click(btn);
    expect(await screen.findByLabelText('Location')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Berlin'));
    expect(api.fetchLeverPrefill).toHaveBeenCalledTimes(1);
    expect(api.fetchLeverGemPrefill).toHaveBeenCalledTimes(1);
  });

  it('keyboard focus prefetches too', async () => {
    wrap(<AddToLeverButton target={{ email: 'new@example.com' }} inLever={false} />);
    const btn = await screen.findByRole('button', { name: 'Add to Lever' });
    btn.focus();
    await waitFor(() => expect(api.fetchLeverGemPrefill).toHaveBeenCalledWith({ email: 'new@example.com' }));
  });

  it('a disabled button does not prefetch', async () => {
    api.fetchLeverMe.mockResolvedValue({ configured: true, createEnabled: false, appEmail: 'a@archive.com', leverUser: { id: 'x', name: null } });
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    await userEvent.hover(await screen.findByRole('button', { name: 'Add to Lever' }));
    expect(api.fetchLeverPrefill).not.toHaveBeenCalled();
  });
});

describe('AddToLeverDialog', () => {
  function openDialog(target: leverApi.LeverTarget = { candidateId: 'c1' }, onCreated = vi.fn()) {
    wrap(<AddToLeverDialog open onOpenChange={() => {}} target={target} onCreated={onCreated} />);
    return onCreated;
  }

  it('preselects the suggested job (listed first) and the Interest Call stage; confirm names both', async () => {
    openDialog();
    const confirm = await screen.findByRole('button', { name: 'Add Jane Doe to Founding Engineer' });
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('combobox', { name: 'Job' })).toHaveTextContent('Founding Engineer');
    expect(screen.getByRole('combobox', { name: 'Job' })).toHaveTextContent('Suggested');
    expect(screen.getByRole('combobox', { name: 'Stage' })).toHaveTextContent('Interest Call');

    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    const options = await screen.findAllByRole('option');
    expect(options[0]).toHaveTextContent('Founding Engineer');
    expect(options[0]).toHaveTextContent('Suggested');
  });

  it('prefills editable fields and shows résumé, source and tag chips plus the note preview', async () => {
    openDialog();
    expect(await screen.findByLabelText('Name')).toHaveValue('Jane Doe');
    expect(screen.getByLabelText('Headline')).toHaveValue('Staff Engineer at Acme');
    await waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Berlin'));
    expect(screen.getByLabelText('LinkedIn')).toHaveValue('https://www.linkedin.com/in/jane');
    expect(screen.getByText('From Gem: Jane_LinkedIn.pdf')).toBeInTheDocument();
    expect(screen.getByText('Gem outreach')).toBeInTheDocument();
    expect(screen.getByText('paul.b')).toBeInTheDocument();
    expect(screen.getByTestId('lever-note-preview')).toHaveTextContent('Sounds great');
  });

  it('no suggestion → no job selected, confirm disabled until one is picked', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ suggestedPostingId: null }));
    openDialog();
    const confirm = await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    expect(confirm).toBeDisabled();
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    await userEvent.click(await screen.findByRole('option', { name: /Product Designer/ }));
    expect(screen.getByRole('button', { name: 'Add Jane Doe to Product Designer' })).toBeEnabled();
  });

  it('one Job field: no separate search box until the combobox opens', async () => {
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    expect(screen.queryByLabelText('Search jobs')).toBeNull();
    expect(screen.getAllByRole('combobox', { name: 'Job' })).toHaveLength(1);
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    expect(await screen.findByLabelText('Search jobs')).toHaveFocus();
  });

  it('typing filters jobs (title, team or location); grouped by team with location shown', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ suggestedPostingId: null }));
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    const design = await screen.findByRole('group', { name: 'Design' });
    expect(within(design).getByRole('option', { name: /Product Designer/ })).toHaveTextContent('Remote');
    expect(screen.getByRole('group', { name: 'Eng' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search jobs'), 'ops');
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([expect.stringContaining('Ops Lead')]));
    await userEvent.clear(screen.getByLabelText('Search jobs'));
    await userEvent.type(screen.getByLabelText('Search jobs'), 'nyc');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option')).toHaveTextContent('Founding Engineer');
  });

  it('no match → "No open jobs match"', async () => {
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    await userEvent.type(await screen.findByLabelText('Search jobs'), 'zzzz');
    expect(await screen.findByText('No open jobs match')).toBeInTheDocument();
  });

  it('keyboard: open, filter, Enter picks the highlighted job and closes', async () => {
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    screen.getByRole('combobox', { name: 'Job' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.type(await screen.findByLabelText('Search jobs'), 'design');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByLabelText('Search jobs')).toBeNull());
    expect(screen.getByRole('combobox', { name: 'Job' })).toHaveTextContent('Product Designer');
    expect(screen.getByRole('button', { name: 'Add Jane Doe to Product Designer' })).toBeEnabled();
  });

  it('keyboard: arrow keys move through jobs', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ suggestedPostingId: null }));
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    await screen.findByLabelText('Search jobs');
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('a scheme-less LinkedIn URL is accepted and sent canonical; a non-LinkedIn URL blocks submit', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ linkedinUrl: null }));
    api.fetchLeverGemPrefill.mockResolvedValue(gemPrefill({ linkedinUrl: null }));
    openDialog();
    const li = await screen.findByLabelText('LinkedIn');
    await screen.findByText('From Gem: Jane_LinkedIn.pdf');
    await userEvent.type(li, 'evil.com/in/jane');
    expect(screen.getByText('Enter a linkedin.com URL')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' })).toBeDisabled();
    await userEvent.clear(li);
    await userEvent.type(li, 'www.linkedin.com/in/jane?trk=x');
    await userEvent.click(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' }));
    await waitFor(() => expect(api.createLeverOpportunity).toHaveBeenCalledTimes(1));
    expect(api.createLeverOpportunity.mock.calls[0]![1].linkedinUrl).toBe('https://www.linkedin.com/in/jane');
  });

  it('warns when already in Lever, and blocks the same job', async () => {
    api.fetchLeverPrefill.mockResolvedValue(
      prefill({
        existingState: 'ACTIVE',
        existing: [
          {
            id: 'opp-old',
            postingId: 'post-fe',
            postingTitle: 'Founding Engineer',
            stage: 'Phone Screen',
            archived: false,
            hired: false,
            archivedReason: null,
            createdAt: null,
            updatedAt: null,
            leverUrl: 'https://hire.lever.co/candidates/opp-old',
          },
        ],
      })
    );
    openDialog();
    const warning = await screen.findByRole('status', { name: 'Already in Lever' });
    expect(warning).toHaveTextContent('Already in Lever on Founding Engineer');
    expect(within(warning).getByRole('link')).toHaveAttribute('href', 'https://hire.lever.co/candidates/opp-old');
    expect(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' })).toBeDisabled();
    expect(screen.getByText(/already has an opportunity for this job/i)).toBeInTheDocument();
  });

  it('confirm sends the confirmed payload with a stable idempotency key, then toasts with a Lever link', async () => {
    const onCreated = openDialog();
    await screen.findByText('From Gem: Jane_LinkedIn.pdf');
    await userEvent.clear(await screen.findByLabelText('Headline'));
    await userEvent.type(screen.getByLabelText('Headline'), 'Principal Engineer');
    await userEvent.click(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' }));

    await waitFor(() => expect(api.createLeverOpportunity).toHaveBeenCalledTimes(1));
    const [target, body] = api.createLeverOpportunity.mock.calls[0]!;
    expect(target).toEqual({ candidateId: 'c1' });
    expect(body).toMatchObject({
      name: 'Jane Doe',
      headline: 'Principal Engineer',
      postingId: 'post-fe',
      stageId: 'stage-ic',
      tags: ['paul.b'],
      sources: ['Gem outreach'],
      includeResume: true,
      phone: '+49 30 1234',
      location: 'Berlin',
      linkedinUrl: 'https://www.linkedin.com/in/jane',
    });
    expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    await waitFor(() => expect(toast.toastSuccess).toHaveBeenCalled());
    expect(toast.toastSuccess.mock.calls[0]![0]).toBe('Added Jane Doe to Founding Engineer');
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: 'opp-new' }));
  });

  it('a failed create keeps the dialog open with the server message', async () => {
    api.createLeverOpportunity.mockRejectedValueOnce(
      Object.assign(new Error('x'), {
        isAxiosError: true,
        response: { status: 409, data: { error: "Your Lever account wasn't found for paul.b@archive.com" } },
      })
    );
    openDialog();
    await userEvent.click(await screen.findByRole('button', { name: 'Add Jane Doe to Founding Engineer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Your Lever account wasn't found");
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('unknown email: name is required; Gem missing shows the manual-LinkedIn hint', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ candidateId: null, name: null, headline: null, linkedinUrl: null }));
    api.fetchLeverGemPrefill.mockResolvedValue(
      gemPrefill({
        status: 'UNAVAILABLE',
        message: 'Gem unavailable — paste LinkedIn manually',
        name: null,
        headline: null,
        location: null,
        phone: null,
        linkedinUrl: null,
        resume: { available: false, source: null, filename: null },
      })
    );
    openDialog({ email: 'new@example.com' });
    expect(await screen.findByText('Gem unavailable — paste LinkedIn manually')).toBeInTheDocument();
    expect(screen.getByText('No résumé')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /^Add .* to Founding Engineer/ });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Name'), 'New Person');
    expect(screen.getByRole('button', { name: 'Add New Person to Founding Engineer' })).toBeEnabled();
  });

  it('flag off (server says so) → confirm disabled with the reason', async () => {
    api.fetchLeverPrefill.mockResolvedValue(prefill({ createEnabled: false }));
    openDialog();
    expect(await screen.findByText('Add to Lever is turned off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' })).toBeDisabled();
  });

  describe('Gem', () => {
    const EMPTY = { headline: null, linkedinUrl: null };
    const GEM_EMPTY = {
      name: null,
      headline: null,
      location: null,
      phone: null,
      linkedinUrl: null,
      resume: { available: false, source: null, filename: null },
    };
    let popup: { location: { href: string }; closed: boolean; close: () => void };

    beforeEach(() => {
      popup = { location: { href: 'about:blank' }, closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
      api.startGemConnect.mockReset().mockResolvedValue('https://gem.test/authorize');
      api.fetchGemStatus.mockReset().mockResolvedValue({ status: 'NOT_CONNECTED', lastError: null });
    });

    function gemCallbackPosts(result: string) {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'gem-oauth', result }, origin: window.location.origin })
      );
    }

    it('not connected → callout; Connect Gem opens the popup, then the refetched prefill fills only EMPTY fields', async () => {
      api.fetchLeverPrefill.mockResolvedValue(prefill(EMPTY));
      api.fetchLeverGemPrefill.mockResolvedValueOnce(gemPrefill({ ...GEM_EMPTY, status: 'NOT_CONNECTED' }));
      openDialog();
      expect(await screen.findByText('Connect Gem to fill in LinkedIn, title, location and résumé')).toBeInTheDocument();
      expect(screen.getByText('No résumé')).toBeInTheDocument();
      // The recruiter types a location while Gem is connecting.
      await userEvent.type(screen.getByLabelText('Location'), 'Lisbon');

      api.fetchLeverGemPrefill.mockResolvedValueOnce(gemPrefill());
      await userEvent.click(screen.getByRole('button', { name: 'Connect Gem' }));
      expect(window.open).toHaveBeenCalledWith('about:blank', 'gem-oauth', expect.any(String));
      await waitFor(() => expect(popup.location.href).toBe('https://gem.test/authorize'));
      gemCallbackPosts('connected');

      await waitFor(() => expect(screen.getByLabelText('LinkedIn')).toHaveValue('https://www.linkedin.com/in/jane'));
      expect(api.fetchLeverGemPrefill).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText('Headline')).toHaveValue('Staff Engineer at Acme');
      expect(screen.getByLabelText('Location')).toHaveValue('Lisbon');
      expect(screen.getByLabelText('Name')).toHaveValue('Jane Doe');
      expect(screen.getAllByText('Filled from Gem')).toHaveLength(2);
      expect(screen.getByText('From Gem: Jane_LinkedIn.pdf')).toBeInTheDocument();
      expect(screen.queryByText('Connect Gem to fill in LinkedIn, title, location and résumé')).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' }));
      await waitFor(() => expect(api.createLeverOpportunity).toHaveBeenCalled());
      expect(api.createLeverOpportunity.mock.calls[0]![1]).toMatchObject({
        location: 'Lisbon',
        linkedinUrl: 'https://www.linkedin.com/in/jane',
        includeResume: true,
      });
    });

    it('connected but the person isn\'t in Gem → muted "Not found in Gem", no callout', async () => {
      api.fetchLeverGemPrefill.mockResolvedValue(gemPrefill({ ...GEM_EMPTY, status: 'NOT_FOUND' }));
      openDialog();
      expect(await screen.findByText('Not found in Gem')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Connect Gem/ })).toBeNull();
    });

    it('NEEDS_REAUTH → "Reconnect Gem"', async () => {
      api.fetchLeverGemPrefill.mockResolvedValue(gemPrefill({ ...GEM_EMPTY, status: 'NEEDS_REAUTH' }));
      openDialog();
      expect(await screen.findByRole('button', { name: 'Reconnect Gem' })).toBeInTheDocument();
    });

    it('a cancelled connect says so and keeps the callout', async () => {
      api.fetchLeverGemPrefill.mockResolvedValue(gemPrefill({ ...GEM_EMPTY, status: 'NOT_CONNECTED' }));
      openDialog();
      await userEvent.click(await screen.findByRole('button', { name: 'Connect Gem' }));
      await waitFor(() => expect(popup.location.href).toBe('https://gem.test/authorize'));
      gemCallbackPosts('denied');
      expect(await screen.findByText('Gem connection was cancelled.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect Gem' })).toBeEnabled();
      expect(api.fetchLeverGemPrefill).toHaveBeenCalledTimes(1);
    });

    it('opens on app data before Gem resolves, with "Fetching from Gem…" placeholders; job/stage usable', async () => {
      const gem = deferredGem();
      api.fetchLeverPrefill.mockResolvedValue(prefill(EMPTY));
      api.fetchLeverGemPrefill.mockReturnValue(gem.promise);
      openDialog();
      expect(await screen.findByLabelText('Name')).toHaveValue('Jane Doe');
      // LinkedIn, headline and location are empty and waiting on Gem.
      expect(screen.getAllByText('Fetching from Gem…')).toHaveLength(3);
      expect(screen.getByText('Fetching résumé from Gem…')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
      await userEvent.click(await screen.findByRole('option', { name: /Product Designer/ }));
      expect(screen.getByRole('button', { name: 'Add Jane Doe to Product Designer' })).toBeEnabled();
      gem.resolve(gemPrefill());
      expect(await screen.findByText('From Gem: Jane_LinkedIn.pdf')).toBeInTheDocument();
      expect(screen.queryByText('Fetching from Gem…')).toBeNull();
    });

    it('when Gem arrives it fills EMPTY fields only (typed values win)', async () => {
      const gem = deferredGem();
      api.fetchLeverPrefill.mockResolvedValue(prefill(EMPTY));
      api.fetchLeverGemPrefill.mockReturnValue(gem.promise);
      openDialog();
      await userEvent.type(await screen.findByLabelText('LinkedIn'), 'linkedin.com/in/typed');
      gem.resolve(gemPrefill());
      await waitFor(() => expect(screen.getByLabelText('Location')).toHaveValue('Berlin'));
      expect(screen.getByLabelText('LinkedIn')).toHaveValue('linkedin.com/in/typed');
      expect(screen.getByLabelText('Headline')).toHaveValue('Staff Engineer at Acme');
      expect(screen.getByLabelText('Name')).toHaveValue('Jane Doe');
      expect(screen.getAllByText('Filled from Gem')).toHaveLength(2);
    });

    it('Confirm works while Gem is loading — and says the résumé will not be attached', async () => {
      api.fetchLeverGemPrefill.mockReturnValue(new Promise(() => {}));
      openDialog();
      const confirm = await screen.findByRole('button', { name: 'Add Jane Doe to Founding Engineer' });
      expect(confirm).toBeEnabled();
      expect(screen.getByText(/Gem is still loading.*without a résumé/)).toBeInTheDocument();
      await userEvent.click(confirm);
      await waitFor(() => expect(api.createLeverOpportunity).toHaveBeenCalledTimes(1));
      expect(api.createLeverOpportunity.mock.calls[0]![1]).toMatchObject({ includeResume: false, phone: null, location: null });
    });

    it('a cached Gem result (no filename) still shows the résumé will attach', async () => {
      api.fetchLeverGemPrefill.mockResolvedValue(
        gemPrefill({ source: 'cache', name: null, phone: null, resume: { available: true, source: null, filename: null } })
      );
      openDialog();
      expect(await screen.findByText('Résumé from Gem')).toBeInTheDocument();
    });

    it('a failed Gem request degrades to the manual-LinkedIn hint; the form still works', async () => {
      api.fetchLeverGemPrefill.mockRejectedValue(new Error('boom'));
      openDialog();
      expect(await screen.findByText('Gem unavailable — paste LinkedIn manually')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add Jane Doe to Founding Engineer' })).toBeEnabled();
    });
  });
});
