import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { fetchMailboxes, addGmailMailbox, fetchDrafts } from '../lib/api';
import { clearToken, clearUser, getUser } from '../lib/auth';
import Dashboard from '../components/Dashboard';
import EmailDrafts from '../components/EmailDrafts';
import CandidateTable from '../components/CandidateTable';
import MailboxFilter from '../components/MailboxFilter';
import { cn } from '../lib/utils';
import { BrainCircuit, Plus, ChevronDown, LogOut, X, CheckCircle2, AlertCircle } from 'lucide-react';

type Tab = 'dashboard' | 'drafts' | 'candidates';
type BannerKind = 'success' | 'error';
interface BannerState {
  kind: BannerKind;
  message: string;
}

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | undefined>();
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const user = getUser();

  // Handle OAuth callback query params
  useEffect(() => {
    const mailboxParam = searchParams.get('mailbox');
    if (!mailboxParam) return;

    if (mailboxParam === 'connected') {
      setBanner({ kind: 'success', message: 'Mailbox connected successfully' });
    } else if (mailboxParam === 'error') {
      const reason = searchParams.get('reason') ?? 'Unknown error';
      setBanner({ kind: 'error', message: `Mailbox connection failed: ${reason}` });
    }

    // Clean URL so a refresh doesn't reshow the banner
    const next = new URLSearchParams(searchParams);
    next.delete('mailbox');
    next.delete('reason');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss the banner after 5 seconds
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner]);

  const { data: mailboxesData, refetch: refetchMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  const { data: draftsData } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => fetchDrafts({ limit: 1000 }),
    staleTime: 30_000,
  });

  const mailboxes = mailboxesData?.data ?? [];
  const pendingDraftCount = (draftsData?.data ?? []).filter((d) => d.status === 'PENDING').length;

  const handleAddMailbox = async () => {
    try {
      const res = await addGmailMailbox();
      window.location.href = res.data.authUrl;
    } catch (err) {
      console.error('Failed to get Gmail auth URL:', err);
    }
  };

  const handleLogout = () => {
    clearToken();
    clearUser();
    window.location.assign('/login');
  };

  const accountLabel = user?.name || user?.email || 'Account';

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'drafts', label: 'Email Drafts', badge: pendingDraftCount > 0 ? pendingDraftCount : undefined },
    { id: 'candidates', label: 'Candidates' },
  ];

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Banner */}
      {banner && (
        <div
          className={cn(
            'border-b',
            banner.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          )}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              {banner.kind === 'success' ? (
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
              )}
              <span>{banner.message}</span>
            </div>
            <button
              onClick={() => setBanner(null)}
              className="p-1 hover:bg-white/5 rounded transition-colors"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <BrainCircuit className="w-7 h-7 text-blue-400" />
              <div>
                <h1 className="text-white font-semibold text-lg leading-none">
                  Archive Recruiting AI
                </h1>
                <p className="text-gray-500 text-xs mt-0.5">Email Automation System</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <MailboxFilter
                mailboxes={mailboxes}
                selectedId={selectedMailboxId}
                onChange={setSelectedMailboxId}
              />
              <button
                onClick={handleAddMailbox}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Mailbox
              </button>

              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm rounded-lg transition-colors max-w-[200px]"
                    aria-label="Account menu"
                  >
                    <span className="truncate">{accountLabel}</span>
                    <ChevronDown className="w-4 h-4 flex-shrink-0" />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={6}
                    className="min-w-[220px] bg-gray-900 border border-gray-800 rounded-lg shadow-xl p-1 z-50"
                  >
                    {user?.email && (
                      <div className="px-3 py-2 border-b border-gray-800 mb-1">
                        {user.name && (
                          <p className="text-white text-sm font-medium truncate">{user.name}</p>
                        )}
                        <p className="text-gray-400 text-xs truncate">{user.email}</p>
                      </div>
                    )}
                    <DropdownMenu.Item
                      onSelect={handleLogout}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800 rounded cursor-pointer outline-none data-[highlighted]:bg-gray-800"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="border-b border-gray-800 bg-gray-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2',
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-400 hover:text-gray-200'
                )}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="px-1.5 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full leading-none">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'dashboard' && (
          <Dashboard
            mailboxId={selectedMailboxId}
            onRefetchMailboxes={refetchMailboxes}
            onSwitchToDrafts={() => setActiveTab('drafts')}
          />
        )}
        {activeTab === 'drafts' && <EmailDrafts mailboxId={selectedMailboxId} />}
        {activeTab === 'candidates' && (
          <CandidateTable mailboxId={selectedMailboxId} />
        )}
      </main>
    </div>
  );
}
