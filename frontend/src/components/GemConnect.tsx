import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { fetchGemStatus, startGemConnect, disconnectGem, type GemConnectionState } from '@/lib/leverApi';
import { extractApiErrorMessage, toastError } from '@/lib/toast';
import { viewHref } from '@/lib/urlState';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

interface Props {
  /** Tests inject this; the browser leaves for Gem's authorize page. */
  navigate?: (url: string) => void;
  className?: string;
  /**
   * `card` (Settings → Integrations): explanation + Disconnect with confirm.
   * `menu` (account menu): one line; a confirm dialog would close with the
   * menu, so disconnecting links to Settings instead.
   */
  variant?: 'card' | 'menu';
}

const STATUS: Record<GemConnectionState, { text: string; variant: 'success' | 'warning' | 'outline' }> = {
  OK: { text: 'Connected', variant: 'success' },
  NEEDS_REAUTH: { text: 'Reconnect needed', variant: 'warning' },
  NOT_CONNECTED: { text: 'Not connected', variant: 'outline' },
  PENDING: { text: 'Not connected', variant: 'outline' },
};

export const GEM_PREFILL_LINE = 'Gem prefills LinkedIn, title, location and résumé when you add someone to Lever.';

/**
 * F3: the current user's Gem (GeMCP) connection, used to prefill Add to
 * Lever. Each recruiter connects their own Gem account.
 */
export default function GemConnect({ navigate = (url) => window.location.assign(url), className, variant = 'card' }: Props) {
  const queryClient = useQueryClient();
  const statusQ = useQuery({ queryKey: ['gem-status'], queryFn: fetchGemStatus, staleTime: 60_000, retry: false });

  const connect = useMutation({
    mutationFn: startGemConnect,
    onSuccess: (url) => navigate(url),
    onError: (err) => toastError('Could not start the Gem connection', extractApiErrorMessage(err, 'Try again later.')),
  });
  const disconnect = useMutation({
    mutationFn: disconnectGem,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gem-status'] });
      // A cached prefill was built for the old connection state.
      void queryClient.invalidateQueries({ queryKey: ['lever-prefill'] });
    },
    onError: (err) => toastError('Could not disconnect Gem', extractApiErrorMessage(err, 'Try again later.')),
  });

  const wrapper = cn('flex flex-col gap-2', variant === 'menu' && 'px-3 py-2', className);

  if (statusQ.isLoading) {
    return (
      <div className={wrapper} data-testid="gem-connect-loading">
        <Skeleton className="h-6 w-40" />
        {variant === 'card' && <Skeleton className="h-4 w-full" />}
      </div>
    );
  }
  if (statusQ.isError || !statusQ.data) {
    return (
      <div className={cn(wrapper, 'flex-row items-center justify-between')}>
        <span role="alert" className="text-sm text-destructive">
          Couldn't load your Gem connection
        </span>
        <Button size="xs" variant="outline" onClick={() => void statusQ.refetch()} disabled={statusQ.isFetching}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </div>
    );
  }

  const data = statusQ.data;
  const connected = data.status === 'OK';
  const status = STATUS[data.status];
  const busy = connect.isPending || disconnect.isPending;

  let action: React.ReactNode;
  if (!connected) {
    action = (
      <Button size="xs" variant="outline" disabled={busy} onClick={() => connect.mutate()}>
        {data.status === 'NEEDS_REAUTH' ? 'Reconnect' : 'Connect'}
      </Button>
    );
  } else if (variant === 'menu') {
    action = <ManageLink />;
  } else {
    action = (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="xs" variant="outline" disabled={busy}>
            Disconnect
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gem?</AlertDialogTitle>
            <AlertDialogDescription>
              Add to Lever will stop prefilling LinkedIn, title, location and résumé until you connect again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => disconnect.mutate()}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <div className={wrapper}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2">
          <span className="text-foreground">Gem</span>
          <Badge variant={status.variant} data-status={data.status}>
            {status.text}
          </Badge>
        </span>
        {action}
      </div>
      {variant === 'card' && <p className="text-xs text-muted-foreground">{GEM_PREFILL_LINE}</p>}
    </div>
  );
}

/** Menu variant only (needs the router; Settings renders the card). */
function ManageLink() {
  const [params] = useSearchParams();
  return (
    <Button asChild size="xs" variant="ghost">
      <Link to={viewHref('/settings/integrations', params)}>Manage</Link>
    </Button>
  );
}
