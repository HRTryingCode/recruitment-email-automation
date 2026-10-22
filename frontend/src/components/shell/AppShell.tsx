import { useQuery } from '@tanstack/react-query';
import { Outlet } from 'react-router-dom';
import { fetchDrafts, fetchMailboxes } from '../../lib/api';
import { useMailboxFilter } from '../../lib/urlState';
import { SidebarInset, SidebarProvider } from '../ui/sidebar';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
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

  const { data: mailboxesData } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  // Badge = the Pending total for the selected mailbox (server count, M22).
  const { data: pendingData } = useQuery({
    queryKey: ['drafts', 'pending-count', mailboxId],
    queryFn: () => fetchDrafts({ status: 'PENDING', mailboxId, limit: 1 }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <SidebarProvider>
      <AppSidebar pendingCount={pendingData?.meta.total ?? 0} />
      <SidebarInset className="min-w-0">
        <AppHeader
          mailboxes={mailboxesData?.data ?? []}
          mailboxId={mailboxId}
          onMailboxChange={setMailboxId}
        />
        <StatusBanner />
        <div className="mx-auto w-full min-w-0 max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
          <Outlet />
        </div>
      </SidebarInset>
      <ShortcutsDialog />
    </SidebarProvider>
  );
}
