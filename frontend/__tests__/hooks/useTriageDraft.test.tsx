import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useTriageDraft } from '../../src/hooks/useTriageDraft';
import type { InboxItem } from '../../src/lib/api';
import * as api from '../../src/lib/api';

vi.mock('../../src/lib/api', () => ({ generateDraftForThread: vi.fn() }));

const item = {
  kind: 'candidate',
  id: 'c1',
  candidate: { id: 'c1', name: 'Ada Example', email: 'ada@example.org' },
  mailbox: { id: 'mb1', emailAddress: 'rae@example.com' },
} as unknown as InboxItem;

describe('useTriageDraft', () => {
  it('a triage reply also refreshes the Candidates list (the server set the status)', async () => {
    vi.mocked(api.generateDraftForThread).mockResolvedValue({ success: true, data: { id: 'd9' } } as never);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onDrafted = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useTriageDraft({ currentKey: () => 'candidate:c1', onDrafted, onOpen: vi.fn() }), { wrapper });

    act(() => result.current.start('candidate:c1', item, 't1', 'INTERESTED'));

    await waitFor(() => expect(onDrafted).toHaveBeenCalled());
    expect(api.generateDraftForThread).toHaveBeenCalledWith('t1', 'INTERESTED');
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys).toEqual(expect.arrayContaining(['["inbox"]', '["candidates"]', '["candidate","c1"]']));
  });
});
