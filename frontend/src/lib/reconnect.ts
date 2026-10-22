import { addGmailMailbox } from './api';
import { extractApiErrorMessage, toastError } from './toast';

/**
 * Start the Gmail OAuth flow (connect a new mailbox or reconnect one).
 * Reconnecting must be done while signed in to Google as the mailbox owner;
 * the callback upserts by address and resets Mailbox.authStatus to OK.
 */
export async function startGmailReconnect(navigate: (url: string) => void = (url) => window.location.assign(url)): Promise<void> {
  try {
    const res = await addGmailMailbox();
    navigate(res.data.authUrl);
  } catch (err) {
    toastError(
      'Could not start the Google sign-in',
      extractApiErrorMessage(err, 'Try again from Settings → Mailboxes.')
    );
  }
}
