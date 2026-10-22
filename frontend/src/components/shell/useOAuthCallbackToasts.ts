import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toastError, toastSuccess } from '../../lib/toast';

/**
 * The Gmail OAuth callback lands on `/?mailbox=connected|error&reason=`; the
 * root redirect carries the params to the new route and this turns them
 * into a toast, then strips them from the URL. (Gem's `?gem=` return is
 * handled before React mounts — lib/gemOAuth.ts.)
 */
export function useOAuthCallbackToasts(): void {
  const [params, setParams] = useSearchParams();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const mailbox = params.get('mailbox');
    if (!mailbox) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;

    if (mailbox === 'connected') {
      toastSuccess('Mailbox connected', 'Inbox sync started — new candidate emails will show up here automatically.');
    } else if (mailbox === 'error') {
      toastError('Mailbox connection failed', params.get('reason') ?? 'Unknown error');
    }

    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ['mailbox', 'reason']) next.delete(k);
        return next;
      },
      { replace: true }
    );
  }, [params, setParams]);
}
