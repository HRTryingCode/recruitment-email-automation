import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AddToLeverButton from '../../src/components/AddToLeverButton';
import AddToLeverDialog from '../../src/components/AddToLeverDialog';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import * as leverApi from '../../src/lib/leverApi';
import type { LeverPrefill } from '../../src/lib/leverApi';

vi.mock('../../src/lib/leverApi', async () => {
  const actual = await vi.importActual<typeof import('../../src/lib/leverApi')>('../../src/lib/leverApi');
  return {
    ...actual,
    fetchLeverMe: vi.fn(),
    fetchLeverPostings: vi.fn(),
    fetchLeverPrefill: vi.fn(),
    createLeverOpportunity: vi.fn(),
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
    location: 'Berlin',
    phone: '+49 30 1234',
    linkedinUrl: 'https://www.linkedin.com/in/jane',
    resume: { available: true, source: 'LinkedIn PDF', filename: 'Jane_LinkedIn.pdf' },
    suggestedPostingId: 'post-fe',
    stageId: 'stage-ic',
    stageName: 'Interest Call',
    origin: 'sourced',
    sources: ['Gem outreach'],
    tags: ['paul.b'],
    note: 'Added from Recruiting Email Automation by paul.b@archive.com.\n\nLatest reply (2026-10-20):\nSounds great',
    existing: [],
    existingState: 'NOT_FOUND',
    gem: { status: 'FOUND' },
    createEnabled: true,
    ...extra,
  };
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
  for (const fn of [api.fetchLeverMe, api.fetchLeverPostings, api.fetchLeverPrefill, api.createLeverOpportunity]) fn.mockReset();
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
    expect(btn).toHaveAttribute('title', 'Add to Lever is turned off');
    await userEvent.click(btn);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no Lever user → disabled with the "account wasn\'t found" reason', async () => {
    api.fetchLeverMe.mockResolvedValue({ configured: true, createEnabled: true, appEmail: 'new@archive.com', leverUser: null });
    wrap(<AddToLeverButton target={{ candidateId: 'c1' }} inLever={false} />);
    const btn = await screen.findByRole('button', { name: 'Add to Lever' });
    expect(btn).toHaveAttribute('title', "Your Lever account wasn't found for new@archive.com");
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
    expect(screen.getByLabelText('Location')).toHaveValue('Berlin');
    expect(screen.getByLabelText('LinkedIn')).toHaveValue('https://www.linkedin.com/in/jane');
    expect(screen.getByText('From Gem: LinkedIn PDF')).toBeInTheDocument();
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

  it('job search filters the list', async () => {
    openDialog();
    await screen.findByRole('button', { name: /^Add Jane Doe to/ });
    await userEvent.type(screen.getByLabelText('Search jobs'), 'ops');
    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('Ops Lead')]);
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
    api.fetchLeverPrefill.mockResolvedValue(
      prefill({
        candidateId: null,
        name: null,
        headline: null,
        linkedinUrl: null,
        resume: { available: false, source: null, filename: null },
        gem: { status: 'UNAVAILABLE', message: 'Gem unavailable — paste LinkedIn manually' },
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
});
