import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LookupBar from '../../src/components/LookupBar';
import ShortcutsDialog from '../../src/components/shell/ShortcutsDialog';
import * as api from '../../src/lib/api';
import type { MailboxSyncHealth } from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({
  fetchLookup: vi.fn(),
  fetchCandidates: vi.fn(),
  fetchSyncHealth: vi.fn(),
  addGmailMailbox: vi.fn(),
  fetchMailboxes: vi.fn(),
}));

const syncHealth = vi.mocked(api.fetchSyncHealth);
const addGmail = vi.mocked(api.addGmailMailbox);

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

function renderPalette(entry = '/inbox?mailboxId=mb1&q=old') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <input aria-label="Other field" />
                <LookupBar />
                <ShortcutsDialog />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  document.documentElement.classList.remove('dark');
  syncHealth.mockResolvedValue({ success: true, data: [] });
  vi.mocked(api.fetchMailboxes).mockResolvedValue({ success: true, data: [] });
});

async function openPalette() {
  fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
  return screen.findByRole('combobox', { name: /email to look up/i });
}

describe('⌘K command palette', () => {
  it('"Filter by mailbox" sets the global mailbox filter on the current page (U2a)', async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchMailboxes).mockResolvedValue({
      success: true,
      data: [
        { id: 'mb1', emailAddress: 'sofia@archive.com' },
        { id: 'mb2', emailAddress: 'paul@archive.com' },
      ] as never,
    });
    renderPalette('/settings/team?mailboxId=mb1');
    const input = await openPalette();
    await user.type(input, 'filter');
    await user.click(await screen.findByRole('option', { name: /filter by mailbox: paul@archive\.com/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/settings/team?mailboxId=mb2');
    await openPalette();
    await user.click(await screen.findByRole('option', { name: /filter by mailbox: all mailboxes/i }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/settings\/team$/);
  });

  it('says "Connect Gmail mailbox"', async () => {
    renderPalette();
    await openPalette();
    expect(await screen.findByRole('option', { name: 'Connect Gmail mailbox' })).toBeInTheDocument();
  });

  it('lists navigation and actions', async () => {
    renderPalette();
    await openPalette();
    for (const name of [/go to inbox/i, /go to candidates/i, /go to today/i, /go to settings/i, /toggle theme/i, /show shortcuts/i]) {
      expect(await screen.findByRole('option', { name })).toBeInTheDocument();
    }
  });

  it('"Go to Candidates" navigates and keeps only the mailbox filter', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette();
    await user.click(await screen.findByRole('option', { name: /go to candidates/i }));
    expect(screen.getByTestId('location')).toHaveTextContent('/candidates?mailboxId=mb1');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('typing filters the commands', async () => {
    const user = userEvent.setup();
    renderPalette();
    const box = await openPalette();
    await user.type(box, 'sett');
    expect(await screen.findByRole('option', { name: /go to settings/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /go to inbox/i })).not.toBeInTheDocument();
  });

  it('"Toggle theme" flips the document theme', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette();
    await user.click(await screen.findByRole('option', { name: /toggle theme/i }));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('offers "Reconnect <mailbox>" for mailboxes that need it', async () => {
    syncHealth.mockResolvedValue({
      success: true,
      data: [{ mailboxId: 'mb-a', emailAddress: 'aaronrampersad@archive.com', authStatus: 'NEEDS_REAUTH', watchExpiresInHours: 10 } as MailboxSyncHealth],
    });
    addGmail.mockResolvedValue({ success: true, data: { authUrl: 'https://accounts.google.com/x' } });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    const user = userEvent.setup();
    renderPalette();
    await openPalette();
    await user.click(await screen.findByRole('option', { name: /reconnect aaronrampersad@archive.com/i }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/x'));
  });

  it('"Show shortcuts" opens the shortcut help', async () => {
    const user = userEvent.setup();
    renderPalette();
    await openPalette();
    await user.click(await screen.findByRole('option', { name: /show shortcuts/i }));
    expect(await screen.findByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('⌘K opens even while typing in another field', async () => {
    renderPalette();
    const other = screen.getByLabelText('Other field');
    other.focus();
    fireEvent.keyDown(other, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('global shortcuts', () => {
  it('? opens the shortcut help', async () => {
    renderPalette();
    fireEvent.keyDown(document.body, { key: '?' });
    expect(await screen.findByRole('heading', { name: /keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('? does nothing while typing', async () => {
    renderPalette();
    const other = screen.getByLabelText('Other field');
    other.focus();
    fireEvent.keyDown(other, { key: '?' });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });

  it('yields ? to a screen that handled it (the Inbox has its own help)', async () => {
    renderPalette();
    const handler = (e: KeyboardEvent) => e.key === '?' && e.preventDefault();
    window.addEventListener('keydown', handler, { capture: true });
    fireEvent.keyDown(document.body, { key: '?' });
    window.removeEventListener('keydown', handler, { capture: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: /keyboard shortcuts/i })).not.toBeInTheDocument();
  });

  it('g then c goes to Candidates', async () => {
    renderPalette();
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 'c' });
    expect(screen.getByTestId('location')).toHaveTextContent('/candidates?mailboxId=mb1');
  });
});
