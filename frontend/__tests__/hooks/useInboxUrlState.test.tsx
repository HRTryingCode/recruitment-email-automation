import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { useInboxUrlState } from '../../src/hooks/useInboxUrlState';

function setup(url: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  return renderHook(() => ({ state: useInboxUrlState(), location: useLocation() }), { wrapper });
}

describe('useInboxUrlState', () => {
  it('reads view, mailbox and item from the URL', () => {
    const { result } = setup('/inbox?view=interested&mailboxId=mb1&item=d1');
    expect(result.current.state).toMatchObject({ view: 'interested', mailboxId: 'mb1', itemId: 'd1' });
  });

  it('falls back to needs_review for a missing or unknown view', () => {
    expect(setup('/inbox').result.current.state.view).toBe('needs_review');
    expect(setup('/inbox?view=bogus').result.current.state.view).toBe('needs_review');
  });

  it('maps a legacy ?draftId= link onto item', () => {
    const { result } = setup('/inbox?draftId=d7');
    expect(result.current.state.itemId).toBe('d7');
    expect(result.current.location.search).toBe('?item=d7');
  });

  it('setView switches view and closes the open item', () => {
    const { result } = setup('/inbox?view=interested&item=d1&mailboxId=mb1');
    act(() => result.current.state.setView('snoozed'));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('view')).toBe('snoozed');
    expect(params.get('item')).toBeNull();
    expect(params.get('mailboxId')).toBe('mb1');
  });

  it('ignores the Gmail OAuth ?mailbox= flag (the shell filter is mailboxId)', () => {
    expect(setup('/inbox?mailbox=connected').result.current.state.mailboxId).toBeUndefined();
  });

  it('legacy ?status=SENT opens Sent today', () => {
    expect(setup('/inbox?status=SENT').result.current.state.view).toBe('sent_today');
  });

  it('exposes a legacy ?candidateId= and resolveCandidate swaps it for the item', () => {
    const { result } = setup('/inbox?candidateId=c2');
    expect(result.current.state.legacyCandidateId).toBe('c2');
    act(() => result.current.state.resolveCandidate('d2'));
    expect(result.current.location.search).toBe('?item=d2');
  });

  it('setItem and setMailbox update their params', () => {
    const { result } = setup('/inbox');
    act(() => result.current.state.setItem('d2'));
    expect(result.current.state.itemId).toBe('d2');
    act(() => result.current.state.setMailbox('mb2'));
    expect(result.current.state.mailboxId).toBe('mb2');
    act(() => result.current.state.setItem(undefined));
    expect(result.current.state.itemId).toBeUndefined();
  });
});
