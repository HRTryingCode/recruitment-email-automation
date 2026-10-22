import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, X } from 'lucide-react';
import { fetchSyncHealth } from '../../lib/api';
import { shortAddress } from '../../lib/mailboxHealth';
import { startGmailReconnect } from '../../lib/reconnect';
import { bannerIssues, dismiss, dismissKey, isDismissed } from '../../lib/statusBanner';
import { viewHref } from '../../lib/urlState';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';

/**
 * Global "something is broken" banner on every screen: any mailbox that
 * needs reconnecting (NEEDS_REAUTH or watch expired). Several issues
 * collapse into one banner with a count.
 */
export default function StatusBanner() {
  const [params] = useSearchParams();
  const { data } = useQuery({
    queryKey: ['sync-health'],
    queryFn: fetchSyncHealth,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
  const issues = bannerIssues(data?.data ?? []);
  // Re-read sessionStorage when the issue set changes.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const key = dismissKey(issues);

  if (issues.length === 0 || dismissedKey === key || isDismissed(issues)) return null;

  const title =
    issues.length === 1
      ? `${shortAddress(issues[0].emailAddress)} needs reconnecting`
      : `${issues.length} mailboxes need reconnecting`;

  return (
    <div className="px-4 pt-4 sm:px-6 lg:px-8">
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          {issues.length === 1
            ? 'New candidate email from this mailbox is not syncing. Sign in to Google as the mailbox owner to reconnect.'
            : `${issues.map((i) => shortAddress(i.emailAddress)).join(', ')} — new candidate email is not syncing.`}
        </AlertDescription>
        <div className="col-start-2 mt-2 flex flex-wrap items-center gap-1">
          {issues.length > 1 && (
            <Button asChild size="xs" variant="ghost">
              <Link to={viewHref('/settings/mailboxes', params)}>Details</Link>
            </Button>
          )}
          <Button
            size="xs"
            onClick={() => void startGmailReconnect()}
            aria-label={`Reconnect ${issues.length === 1 ? issues[0].emailAddress : 'mailbox'}`}
          >
            Reconnect
          </Button>
        </div>
        <AlertAction>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(issues);
              setDismissedKey(key);
            }}
          >
            <X />
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
