import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCandidateShortcuts, CANDIDATE_SHORTCUTS } from '../../src/hooks/useCandidateShortcuts';

function Harness(props: { handlers: Parameters<typeof useCandidateShortcuts>[0]; enabled?: boolean }) {
  useCandidateShortcuts(props.handlers, props.enabled);
  return (
    <div>
      <input aria-label="search" />
      <div role="menu">
        <button type="button">item</button>
      </div>
    </div>
  );
}

function setup(enabled = true) {
  const handlers = { prev: vi.fn(), next: vi.fn(), open: vi.fn(), close: vi.fn(), toggle: vi.fn() };
  const utils = render(<Harness handlers={handlers} enabled={enabled} />);
  return { handlers, ...utils };
}

describe('useCandidateShortcuts — ↑ ↓ ↵ Esc x only', () => {
  it('maps the five keys', () => {
    const { handlers } = setup();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(handlers.next).toHaveBeenCalledTimes(1);
    expect(handlers.prev).toHaveBeenCalledTimes(1);
    expect(handlers.open).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
    expect(handlers.toggle).toHaveBeenCalledTimes(1);
  });

  it('ignores the Inbox-only keys (j/k/e/d/s)', () => {
    const { handlers } = setup();
    for (const key of ['j', 'k', 'e', 'd', 's']) fireEvent.keyDown(window, { key });
    for (const fn of Object.values(handlers)) expect(fn).not.toHaveBeenCalled();
  });

  it('does nothing while typing, inside menus/dialogs, with modifiers, or when disabled', () => {
    const { handlers, getByLabelText, getByText, unmount } = setup();
    fireEvent.keyDown(getByLabelText('search'), { key: 'x' });
    fireEvent.keyDown(getByLabelText('search'), { key: 'ArrowDown' });
    fireEvent.keyDown(getByText('item'), { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'x', metaKey: true });
    expect(handlers.toggle).not.toHaveBeenCalled();
    expect(handlers.next).not.toHaveBeenCalled();
    expect(handlers.open).not.toHaveBeenCalled();
    unmount();
    const off = setup(false);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(off.handlers.next).not.toHaveBeenCalled();
  });

  it('leaves the key after `g` to the shell navigation', () => {
    const { handlers } = setup();
    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'x' });
    expect(handlers.toggle).not.toHaveBeenCalled();
  });

  it('documents exactly the five shortcuts', () => {
    expect(CANDIDATE_SHORTCUTS.map((s) => s.keys.join(' '))).toEqual(['↑', '↓', '↵', 'Esc', 'X']);
  });
});
