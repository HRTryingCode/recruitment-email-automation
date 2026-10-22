import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDraftKeyboardShortcuts } from '../../src/hooks/useDraftKeyboardShortcuts';

function mount() {
  const handlers = {
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onApprove: vi.fn(),
    onDiscard: vi.fn(),
  };
  renderHook(() => useDraftKeyboardShortcuts(handlers, { paneOpen: true }));
  return handlers;
}

function press(target: HTMLElement, key: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('draft shortcuts vs the CC dropdown (F4)', () => {
  it.each(['combobox', 'listbox'])('keys inside a %s never trigger draft shortcuts', (role) => {
    const h = mount();
    const host = document.createElement('div');
    host.setAttribute('role', role);
    const inner = document.createElement('div');
    inner.setAttribute('role', role === 'listbox' ? 'option' : 'presentation');
    host.appendChild(inner);
    document.body.appendChild(host);

    for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'a', 'x']) press(inner, key);

    for (const fn of Object.values(h)) expect(fn).not.toHaveBeenCalled();
  });

  it('still fires from ordinary page focus', () => {
    const h = mount();
    press(document.body, 'j');
    expect(h.onNext).toHaveBeenCalledTimes(1);
  });
});
