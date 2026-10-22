import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Text for a polite live region. announce() blanks it first so the same
 * sentence twice in a row is read again.
 */
export function useLiveAnnouncer(): { message: string; announce: (text: string) => void } {
  const [message, setMessage] = useState('');
  const timer = useRef<number | null>(null);
  const announce = useCallback((text: string) => {
    setMessage('');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(text), 50);
  }, []);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );
  return { message, announce };
}
