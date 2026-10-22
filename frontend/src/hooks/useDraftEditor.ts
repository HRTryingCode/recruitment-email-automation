import { useCallback, useEffect, useState } from 'react';
import type { EmailDraft } from '../lib/api';

// Unsaved edits are mirrored to sessionStorage so they survive switching
// replies or a 401 bounce through /login (L17). Same key as the old pane.
const PREFIX = 'draftEdit:';

function readStored(id: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + id);
  } catch {
    return null;
  }
}

function writeStored(id: string, body: string | null): void {
  try {
    if (body === null) window.sessionStorage.removeItem(PREFIX + id);
    else window.sessionStorage.setItem(PREFIX + id, body);
  } catch {
    // best-effort
  }
}

export interface DraftEditorState {
  body: string;
  setBody: (body: string) => void;
  /** Body differs from what the server has. */
  dirty: boolean;
  focused: boolean;
  setFocused: (focused: boolean) => void;
  /** Adopt a server body (after save / rewrite / send) and drop the stored edit. */
  reset: (body: string) => void;
}

/** Local editing state for the open draft's plain-text body. */
export function useDraftEditor(draft: EmailDraft | undefined): DraftEditorState {
  const id = draft?.id;
  const serverBody = draft?.bodyText ?? '';
  const [state, setState] = useState<{ id?: string; body: string; base: string }>({ body: '', base: '' });
  const [focused, setFocused] = useState(false);

  // New draft opened (or first load): restore a stored edit if one exists.
  // Same draft with a new server body: adopt it unless there are local edits.
  useEffect(() => {
    if (!id) return;
    setState((prev) => {
      if (prev.id !== id) return { id, body: readStored(id) ?? serverBody, base: serverBody };
      if (prev.body === prev.base) return { id, body: serverBody, base: serverBody };
      return { ...prev, base: serverBody };
    });
  }, [id, serverBody]);

  const setBody = useCallback(
    (body: string) => {
      setState((prev) => {
        if (prev.id) writeStored(prev.id, body === prev.base ? null : body);
        return { ...prev, body };
      });
    },
    []
  );

  const reset = useCallback((body: string) => {
    setState((prev) => {
      if (prev.id) writeStored(prev.id, null);
      return { ...prev, body, base: body };
    });
  }, []);

  const current = state.id === id ? state : { body: serverBody, base: serverBody };
  return { body: current.body, setBody, dirty: current.body !== current.base, focused, setFocused, reset };
}
