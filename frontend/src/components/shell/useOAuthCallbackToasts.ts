import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toastError, toastSuccess } from '../../lib/toast';

/**
 * Gmail (`?mailbox=connected|error&reason=`) and Gem (`?gem=…`) OAuth
 * callbacks land on `/`; the root redirect carries the params to the new
 * route and this turns them into a toast, then strips them from the URL.
 */
export function useOAuthCallbackToasts(): void {
  const [params, setParams] = useSearchParams();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const mailbox = params.get('mailbox');
    const gem = params.get('gem');
    if (!mailbox && !gem) return;
    const key = params.toString();
    if (handled.current === key) return;
    handled.current = key;

    if (mailbox === 'connected') {
      toastSuccess('Mailbox connected', 'Inbox sync started — new candidate emails will show up here automatically.');
    } else if (mailbox === 'error') {
      toastError('Mailbox connection failed', params.get('reason') ?? 'Unknown error');
    }
    if (gem === 'connected') {
      toastSuccess('Gem connected', 'Add to Lever will now prefill from Gem.');
    } else if (gem === 'denied') {
      toastError('Gem connection cancelled');
    } else if (gem) {
      toastError('Gem connection failed', 'Try connecting again from Settings → Integrations.');
    }

    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ['mailbox', 'reason', 'gem']) next.delete(k);
        return next;
      },
      { replace: true }
    );
  }, [params, setParams]);
}
