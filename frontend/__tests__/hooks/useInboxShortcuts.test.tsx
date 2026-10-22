import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInboxShortcuts, SHORTCUTS, type InboxShortcut } from '../../src/hooks/useInboxShortcuts';

const ids: InboxShortcut[] = ['prev', 'next', 'open', 'edit', 'send', 'undo', 'dismiss', 'snooze', 'close', 'interested', 'not_interested'];
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
    ['i', {}, 'interested'],
    ['n', {}, 'not_interested'],
    ['Enter', { metaKey: true }, 'send'],
    ['Enter', { ctrlKey: true }, 'send'],
    ['z', { metaKey: true }, 'undo'],
  ] as const)('%s %o → %s', (key, mods, id) => {
    setup();
    fireEvent.keyDown(document.body, { key, ...mods });
    expect(handlers[id]).toHaveBeenCalledTimes(1);
    for (const other of ids.filter((x) => x !== id)) expect(handlers[other]).not.toHaveBeenCalled();
  });

  it('leaves ? to the shell (one shared shortcuts dialog)', () => {
    setup();
    const ev = new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('never fires single-key shortcuts while typing', () => {
    const { editor, field } = setup();
    for (const key of ['d', 's', 'e', 'i', 'n', 'j', 'k', 'ArrowDown', 'ArrowUp', 'Enter', '?']) {
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

  it('leaves ⌘K to the shell palette', () => {
    setup();
    const e = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('yields the key after g to the shell (g s = Settings, not Snooze)', () => {
    setup();
    fireEvent.keyDown(document.body, { key: 'g' });
    fireEvent.keyDown(document.body, { key: 's' });
    expect(handlers.snooze).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: 's' });
    expect(handlers.snooze).toHaveBeenCalledTimes(1);
  });

  it('documents every shortcut for the help dialog', () => {
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual([...ids].sort());
  });

  it('allowWhileTyping lets a chosen shortcut through from the editor', () => {
    let allow = true;
    function Allowing() {
      useInboxShortcuts(handlers, true, (id) => id === 'undo' && allow);
      return <textarea aria-label="editor" />;
    }
    const { getByLabelText } = render(<Allowing />);
    const editor = getByLabelText('editor');
    fireEvent.keyDown(editor, { key: 'z', metaKey: true });
    expect(handlers.undo).toHaveBeenCalledTimes(1);
    allow = false;
    fireEvent.keyDown(editor, { key: 'z', metaKey: true });
    expect(handlers.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(editor, { key: 'd' });
    expect(handlers.dismiss).not.toHaveBeenCalled();
  });
});
