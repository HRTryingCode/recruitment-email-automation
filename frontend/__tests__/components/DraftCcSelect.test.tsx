import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DraftCcSelect from '../../src/components/DraftCcSelect';
import type { EmailDraft } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({ fetchDraftCcOptions: vi.fn() }));
const fetchOptions = vi.mocked(api.fetchDraftCcOptions);

const OPTIONS = [
  { email: null, name: 'No CC', firstName: null },
  { email: 'catalina.roman@archive.com', name: 'Catalina Roman', firstName: 'Catalina' },
  { email: 'sofia@archive.com', name: 'Sofia Delgado', firstName: 'Sofia' },
];

function draft(overrides: Partial<EmailDraft> = {}): EmailDraft {
  return {
    id: 'draft-1',
    threadId: 'thread-1',
    subject: 'Re: role',
    bodyText: "Hi Ada,\n\nI'm looping in Sofia from the recruitment team here, who will coordinate timing for the interview.",
    classification: 'INTERESTED',
    confidence: 0.9,
    status: 'PENDING',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ccAddress: 'sofia@archive.com',
    ...overrides,
  };
}

function renderSelect(d: EmailDraft, onChange = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DraftCcSelect draft={d} onChange={onChange} />
    </QueryClientProvider>
  );
  return onChange;
}

describe('DraftCcSelect', () => {
  beforeEach(() => {
    fetchOptions.mockReset().mockResolvedValue({ success: true, data: OPTIONS });
  });

  it('shows the draft\'s current CC and asks for options for this draft', async () => {
    renderSelect(draft());
    const trigger = await screen.findByRole('combobox', { name: /cc/i });
    await waitFor(() => expect(trigger).toHaveTextContent('Sofia Delgado'));
    expect(fetchOptions).toHaveBeenCalledWith('draft-1');
  });

  it('choosing another admin calls onChange with their address', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect(draft());
    const trigger = await screen.findByRole('combobox', { name: /cc/i });
    await waitFor(() => expect(trigger).toHaveTextContent('Sofia Delgado'));
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: /Catalina Roman/ }));
    expect(onChange).toHaveBeenCalledWith('catalina.roman@archive.com');
  });

  it('is keyboard operable', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect(draft({ ccAddress: null }));
    const trigger = await screen.findByRole('combobox', { name: /cc/i });
    await waitFor(() => expect(trigger).toHaveTextContent('No CC'));
    trigger.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith('catalina.roman@archive.com');
  });

  it('"No CC" calls onChange with null', async () => {
    const user = userEvent.setup();
    const onChange = renderSelect(draft());
    const trigger = await screen.findByRole('combobox', { name: /cc/i });
    await waitFor(() => expect(trigger).toHaveTextContent('Sofia Delgado'));
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'No CC' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('is disabled for a SENT draft', async () => {
    renderSelect(draft({ status: 'SENT' }));
    expect(await screen.findByRole('combobox', { name: /cc/i })).toBeDisabled();
  });

  it('warns when a hand-off draft has no CC', async () => {
    renderSelect(draft({ ccAddress: null }));
    expect(await screen.findByText(/still says you're looping someone in/i)).toBeInTheDocument();
  });

  it('does not warn for No CC on a regular reply', async () => {
    renderSelect(draft({ ccAddress: null, bodyText: 'Hi Ada,\n\nThanks!' }));
    await screen.findByRole('combobox', { name: /cc/i });
    expect(screen.queryByText(/still says you're looping someone in/i)).not.toBeInTheDocument();
  });
});
