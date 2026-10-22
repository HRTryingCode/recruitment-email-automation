import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchGemStatus, startGemConnect, disconnectGem } from '@/lib/leverApi';
import { extractApiErrorMessage, toastError } from '@/lib/toast';
import { cn } from '@/lib/utils';

interface Props {
  /** Tests inject this; the browser leaves for Gem's authorize page. */
  navigate?: (url: string) => void;
  className?: string;
}

const LABEL = {
  NOT_CONNECTED: 'Gem: not connected',
  PENDING: 'Gem: not connected',
  OK: 'Gem: Connected',
  NEEDS_REAUTH: 'Gem: reconnect needed',
} as const;

/**
 * F3: the current user's Gem (GeMCP) connection, used to prefill Add to
 * Lever. Each recruiter connects their own Gem account.
 */
export default function GemConnect({ navigate = (url) => window.location.assign(url), className }: Props) {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ['gem-status'], queryFn: fetchGemStatus, staleTime: 60_000, retry: false });

  const connect = useMutation({
    mutationFn: startGemConnect,
    onSuccess: (url) => navigate(url),
    onError: (err) => toastError('Could not start the Gem connection', extractApiErrorMessage(err, 'Try again later.')),
  });
  const disconnect = useMutation({
    mutationFn: disconnectGem,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['gem-status'] }),
    onError: (err) => toastError('Could not disconnect Gem', extractApiErrorMessage(err, 'Try again later.')),
  });

  if (!data) return null;
  const connected = data.status === 'OK';
  const action = connected ? 'Disconnect' : data.status === 'NEEDS_REAUTH' ? 'Reconnect' : 'Connect';

  return (
    <div className={cn('flex items-center justify-between gap-3 px-3 py-2 text-[13px]', className)}>
      <span className={cn(connected ? 'text-fg-default' : 'text-fg-muted', data.status === 'NEEDS_REAUTH' && 'text-amber-700 dark:text-amber-300')}>
        {LABEL[data.status]}
      </span>
      <button
        type="button"
        disabled={connect.isPending || disconnect.isPending}
        onClick={() => (connected ? disconnect.mutate() : connect.mutate())}
        className="rounded-md px-2 py-0.5 text-[12px] font-medium text-accent-700 ring-1 ring-inset ring-accent-500/20 hover:bg-accent-500/10 disabled:opacity-50 dark:text-accent-300"
      >
        {action}
      </button>
    </div>
  );
}
