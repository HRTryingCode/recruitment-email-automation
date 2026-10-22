import { useEffect } from 'react';
import type { GemOAuthResult } from '@/lib/gemOAuth';
import { toastError, toastSuccess } from '@/lib/toast';

/** Full-page Gem connect (account menu) finished: say how it went, once. */
export default function GemReturnToast({ result }: { result: GemOAuthResult }) {
  useEffect(() => {
    if (result === 'connected') toastSuccess('Gem connected', 'Add to Lever will prefill from Gem.');
    else if (result === 'denied') toastError('Gem connection was cancelled');
    else toastError('Gem connection failed', 'Try again from the account menu.');
  }, [result]);
  return null;
}
