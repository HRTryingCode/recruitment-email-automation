import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Outlet, useMatch, useSearchParams } from 'react-router-dom';
import { fetchMailboxes } from '../../lib/api';
import { inboxCounts, inboxQueryOptions, inboxSortFrom, inboxViewFrom, waitingCount } from '../../lib/inboxQuery';
import { useMailboxFilter } from '../../lib/urlState';
import { cn } from '../../lib/utils';
import { SidebarInset, SidebarProvider } from '../ui/sidebar';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import ConnectMailboxCard from './ConnectMailboxCard';
import StatusBanner from './StatusBanner';
import ShortcutsDialog from './ShortcutsDialog';
import { useOAuthCallbackToasts } from './useOAuthCallbackToasts';

/**
 * Signed-in layout: collapsible sidebar (Sheet on mobile), header with ⌘K,
 * mailbox filter, theme and account menu, the global mailbox status
 * banner, then the current route.
 */
export default function AppShell() {
  useOAuthCallbackToasts();
  const [mailboxId, setMailboxId] = useMailboxFilter();
  // The Inbox is a full-bleed, viewport-high three-pane layout whose panes
  // scroll on their own; every other view is a centred, page-scrolling column.
  const onInbox = !!useMatch('/inbox');
  const onToday = !!useMatch('/today');
  const fullBleed = onInbox;
  const [params] = useSearchParams();

  const { data: mailboxesData, isSuccess: mailboxesLoaded } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  // Badge = replies waiting in the rail's three triage views. On /inbox it
  // reads the page's own query (same view, sort and role filter as the rail),
  // elsewhere the default view — so it never disagrees with the rail or adds
  // a poll. (Mid-triage, H8's list can briefly show another view; the badge
  // then follows the URL's view, which is the one the rail highlights.)
  const { data: inboxData } = useInfiniteQuery(
    inboxQueryOptions(
      onInbox
        ? { view: inboxViewFrom(params), mailboxId, sort: inboxSortFrom(params), roles: params.getAll('role') }
        : { view: 'needs_review', mailboxId }
    )
  );

  // First run: nothing can reach the Inbox or Today until a mailbox is
  // connected. Only on a successful empty list — never while loading or on error.
  const needsMailbox = mailboxesLoaded && (mailboxesData?.data.length ?? 0) === 0 && (onInbox || onToday);

  return (
    <SidebarProvider>
      <AppSidebar waitingCount={waitingCount(inboxCounts(inboxData))} />
      <SidebarInset className={cn('min-w-0', fullBleed && 'h-svh overflow-hidden')}>
        <AppHeader
          mailboxes={mailboxesData?.data ?? []}
          mailboxId={mailboxId}
          onMailboxChange={setMailboxId}
        />
        <StatusBanner />
        <div
          className={cn(
            'w-full min-w-0 flex-1',
            fullBleed ? 'flex min-h-0 flex-col' : 'mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8'
          )}
        >
          {needsMailbox ? <ConnectMailboxCard className="m-auto max-w-md" /> : <Outlet />}
        </div>
      </SidebarInset>
      <ShortcutsDialog />
    </SidebarProvider>
  );
}
