// U1b item 4: a reply we sent that turns FAILED is never silent.
import { http, HttpResponse } from 'msw';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Toaster } from '../../src/components/ui/sonner';
import { SEND_WATCH_MS, SEND_WATCH_TIMEOUT_MS, useSendWatch } from '../../src/hooks/useSendWatch';
import { server } from '../components/inbox/fixtures';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

function serveStatuses(statuses: string[], sendError = 'Gmail rejected the message') {
  const seen: string[] = [];
  server.use(
    http.get('*/api/drafts/:id', ({ params }) => {
      const status = statuses[Math.min(seen.length, statuses.length - 1)];
      seen.push(String(params.id));
      return HttpResponse.json({ success: true, data: { id: params.id, status, sendError: status === 'FAILED' ? sendError : null } });
    })
  );
  return seen;
}

const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(SEND_WATCH_MS);
  });

describe('useSendWatch', () => {
  it('toasts "Send to … failed" with Open when a watched send fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serveStatuses(['SCHEDULED', 'FAILED']);
    const onOpen = vi.fn();
    render(<Toaster />);
    const { result } = renderHook(() => useSendWatch(onOpen));
    act(() => result.current.watch([{ id: 'd1', name: 'Ana Example' }]));
    await tick();
    expect(screen.queryByText('Send to Ana Example failed')).not.toBeInTheDocument();
    await tick();
    expect(await screen.findByText('Send to Ana Example failed')).toBeInTheDocument();
    expect(screen.getByText('Gmail rejected the message')).toBeInTheDocument();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('d1');
  });

  it('stops watching once the send went out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen = serveStatuses(['SENT']);
    render(<Toaster />);
    const { result } = renderHook(() => useSendWatch(vi.fn()));
    act(() => result.current.watch([{ id: 'd1', name: 'Ana' }]));
    await tick();
    await tick();
    await tick();
    expect(seen).toHaveLength(1);
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const seen = serveStatuses(['SENDING']);
    render(<Toaster />);
    const { result } = renderHook(() => useSendWatch(vi.fn()));
    act(() => result.current.watch([{ id: 'd1', name: 'Ana' }]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEND_WATCH_TIMEOUT_MS + SEND_WATCH_MS);
    });
    const n = seen.length;
    await tick();
    expect(seen).toHaveLength(n);
  });
});
