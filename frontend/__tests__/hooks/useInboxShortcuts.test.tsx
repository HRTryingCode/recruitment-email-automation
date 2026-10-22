import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxShortcuts, SHORTCUTS, type InboxShortcut } from '../../src/hooks/useInboxShortcuts';

const ids: InboxShortcut[] = ['prev', 'next', 'open', 'edit', 'send', 'undo', 'dismiss', 'snooze', 'close', 'palette', 'help'];
let handlers: Record<InboxShortcut, ReturnType<typeof vi.fn>>;

function Harness({ enabled = true }: { enabled?: boolean }) {
  useInboxShortcuts(handlers, enabled);
  return (
    <div>
      <textarea aria-label="editor" />
      <input aria-label="field" />
    </div>
  );
}

function setup(enabled = true) {
  const utils = render(<Harness enabled={enabled} />);
  return { ...utils, editor: utils.getByLabelText('editor'), field: utils.getByLabelText('field') };
}

beforeEach(() => {
  handlers = Object.fromEntries(ids.map((id) => [id, vi.fn()])) as typeof handlers;
});

describe('useInboxShortcuts', () => {
  it.each([
    ['ArrowDown', {}, 'next'],
    ['ArrowUp', {}, 'prev'],
    ['j', {}, 'next'],
    ['k', {}, 'prev'],
    ['Enter', {}, 'open'],
    ['e', {}, 'edit'],
    ['d', {}, 'dismiss'],
    ['s', {}, 'snooze'],
    ['Escape', {}, 'close'],
    ['?', { shiftKey: true }, 'help'],
    ['Enter', { metaKey: true }, 'send'],
    ['Enter', { ctrlKey: true }, 'send'],
    ['z', { metaKey: true }, 'undo'],
    ['k', { metaKey: true }, 'palette'],
  ] as const)('%s %o → %s', (key, mods, id) => {
    setup();
    fireEvent.keyDown(document.body, { key, ...mods });
    expect(handlers[id]).toHaveBeenCalledTimes(1);
    for (const other of ids.filter((x) => x !== id)) expect(handlers[other]).not.toHaveBeenCalled();
  });

  it('never fires single-key shortcuts while typing', () => {
    const { editor, field } = setup();
    for (const key of ['d', 's', 'e', 'j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', '?']) {
      fireEvent.keyDown(editor, { key });
      fireEvent.keyDown(field, { key });
    }
    fireEvent.keyDown(editor, { key: 'z', metaKey: true });
    for (const id of ids) expect(handlers[id]).not.toHaveBeenCalled();
  });

  it('fires ⌘↵ and Esc while typing', () => {
    const { editor, field } = setup();
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(handlers.send).toHaveBeenCalledTimes(1);
    expect(handlers.close).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    setup(false);
    fireEvent.keyDown(document.body, { key: 'd' });
    expect(handlers.dismiss).not.toHaveBeenCalled();
  });

  it('ignores the retired a/x/r shortcuts', () => {
    setup();
    for (const key of ['a', 'x', 'r']) fireEvent.keyDown(document.body, { key });
    for (const id of ids) expect(handlers[id]).not.toHaveBeenCalled();
  });

  it('documents every shortcut for the help dialog', () => {
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual([...ids].sort());
  });
});
