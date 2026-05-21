import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import { fetchMailboxes, addGmailMailbox, fetchDrafts } from '../lib/api';
import { clearToken, clearUser, getUser } from '../lib/auth';
import { toastError, toastSuccess, extractApiErrorMessage } from '../lib/toast';
import Dashboard from '../components/Dashboard';
import EmailDrafts from '../components/EmailDrafts';
import CandidateTable from '../components/CandidateTable';
import MailboxFilter from '../components/MailboxFilter';
import ThemeToggle from '../components/ThemeToggle';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { cn } from '../lib/utils';
import {
  Plus,
  ChevronDown,
  LogOut,
  LayoutDashboard,
  FileText,
  Users,
  Sparkles,
} from 'lucide-react';

type Tab = 'dashboard' | 'drafts' | 'candidates';

const VALID_TABS: Tab[] = ['dashboard', 'drafts', 'candidates'];

function isTab(value: string | null): value is Tab {
  return value !== null && (VALID_TABS as string[]).includes(value);
}

function Avatar({
  url,
  name,
  email,
  size = 32,
}: {
  url?: string | null;
  name?: string;
  email?: string;
  size?: number;
}) {
  const seed = (name || email || '?').trim();
  const initials = seed
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt={seed}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="rounded-full ring-1 ring-fg-strong/[0.08]"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-accent-500 to-accent-700 text-[11px] font-semibold text-white ring-1 ring-fg-strong/[0.08]"
    >
      {initials || '?'}
    </div>
  );
}

export default function Index() {
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = isTab(searchParams.get('tab'))
    ? (searchParams.get('tab') as Tab)
    : 'dashboard';
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | undefined>();
  const user = getUser();

  // OAuth callback feedback → surface via toast (replaces the old top banner).
  useEffect(() => {
    const mailboxParam = searchParams.get('mailbox');
    if (!mailboxParam) return;

    if (mailboxParam === 'connected') {
      toastSuccess(
        'Mailbox connected',
        'Inbox sync started — new candidate emails will show up here automatically.'
      );
    } else if (mailboxParam === 'error') {
      const reason = searchParams.get('reason') ?? 'Unknown error';
      toastError('Mailbox connection failed', reason);
    }

    const next = new URLSearchParams(searchParams);
    next.delete('mailbox');
    next.delete('reason');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep activeTab in sync if the URL changes (e.g. logo nav, deep-links).
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (isTab(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
    if (!tabParam && activeTab !== 'dashboard') {
      setActiveTab('dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleTabChange = (next: string) => {
    if (!isTab(next)) return;
    setActiveTab(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'dashboard') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    // Clear deep-link params when manually switching tabs.
    if (next !== 'drafts') {
      params.delete('candidateId');
      params.delete('draftId');
    }
    setSearchParams(params, { replace: true });
  };

  /**
   * Deep-link helper used by Dashboard rows: jump to drafts tab and pre-open
   * the side-pane for the candidate's most recent pending draft.
   */
  const openDraftForCandidate = (candidateId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'drafts');
    params.set('candidateId', candidateId);
    params.delete('draftId');
    setSearchParams(params);
    setActiveTab('drafts');
  };

  /**
   * Used by the dashboard Quick Triage chevron — opens a specific draft.
   */
  const openDraft = (draftId: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'drafts');
    params.set('draftId', draftId);
    params.delete('candidateId');
    setSearchParams(params);
    setActiveTab('drafts');
  };

  /**
   * Switch to the candidates tab. The optional filter is appended to the URL
   * so future iterations of CandidateTable can consume it; current behavior
   * just switches tabs.
   */
  const switchToCandidates = (filter?: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', 'candidates');
    if (filter) {
      params.set('filter', filter);
    } else {
      params.delete('filter');
    }
    params.delete('candidateId');
    params.delete('draftId');
    setSearchParams(params);
    setActiveTab('candidates');
  };

  const { data: mailboxesData, refetch: refetchMailboxes } = useQuery({
    queryKey: ['mailboxes'],
    queryFn: fetchMailboxes,
    staleTime: 60_000,
  });

  const { data: draftsData } = useQuery({
    queryKey: ['drafts'],
    queryFn: () => fetchDrafts({ limit: 500 }),
    staleTime: 30_000,
  });

  const mailboxes = mailboxesData?.data ?? [];
  const pendingDraftCount = (draftsData?.data ?? []).filter(
    (d) => d.status === 'PENDING'
  ).length;

  const handleAddMailbox = async () => {
    try {
      const res = await addGmailMailbox();
      window.location.href = res.data.authUrl;
    } catch (err) {
      toastError(
        'Could not start Gmail connection',
        extractApiErrorMessage(err, 'Try again in a moment.')
      );
    }
  };

  const handleLogout = () => {
    clearToken();
    clearUser();
    window.location.assign('/login');
  };

  const accountLabel = user?.name || user?.email || 'Account';

  const tabs = useMemo(
    () =>
      [
        { id: 'dashboard' as const, label: 'Dashboard', icon: LayoutDashboard },
        {
          id: 'drafts' as const,
          label: 'Email Drafts',
          icon: FileText,
          badge: pendingDraftCount > 0 ? pendingDraftCount : undefined,
        },
        { id: 'candidates' as const, label: 'Candidates', icon: Users },
      ],
    [pendingDraftCount]
  );

  return (
    <div className="min-h-screen text-fg-default">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-surface-base/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            onClick={() => handleTabChange('dashboard')}
            className="group flex items-center gap-2.5 transition-opacity hover:opacity-90"
            aria-label="Go to dashboard"
          >
            <div className="relative">
              <div className="absolute inset-0 rounded-lg bg-accent-500/30 blur-md transition-opacity group-hover:opacity-100 opacity-60" />
              <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-accent-400 via-accent-500 to-accent-700 ring-1 ring-white/15">
                <Sparkles className="h-4 w-4 text-white" strokeWidth={2.4} />
              </div>
            </div>
            <div className="hidden sm:block">
              <h1 className="font-display text-[15px] font-semibold leading-none tracking-tight text-fg-strong">
                Archive Recruiting
              </h1>
              <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-muted">
                AI Email Automation
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <MailboxFilter
              mailboxes={mailboxes}
              selectedId={selectedMailboxId}
              onChange={setSelectedMailboxId}
            />
            <Button
              size="sm"
              onClick={handleAddMailbox}
              className="rounded-lg bg-accent-500 px-3 py-1.5 text-[13px] font-medium text-white shadow-glow hover:bg-accent-400"
            >
              <Plus data-icon="inline-start" />
              <span className="hidden sm:inline">Add Mailbox</span>
            </Button>

            <ThemeToggle />

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-raised/70 px-1.5 py-1.5 pr-2.5 text-[13px] text-fg-default transition-all hover:border-line-strong hover:bg-surface-elevated"
                  aria-label="Account menu"
                >
                  <Avatar url={user?.avatarUrl} name={user?.name} email={user?.email} size={26} />
                  <span className="hidden max-w-[120px] truncate text-fg-default sm:inline">
                    {accountLabel}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-fg-muted" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 min-w-[240px] overflow-hidden rounded-xl border border-line bg-surface-elevated/95 p-1 shadow-2xl backdrop-blur-xl animate-fade-in"
                >
                  {(user?.name || user?.email) && (
                    <div className="flex items-center gap-3 border-b border-line px-3 py-3">
                      <Avatar
                        url={user?.avatarUrl}
                        name={user?.name}
                        email={user?.email}
                        size={36}
                      />
                      <div className="min-w-0 flex-1">
                        {user?.name && (
                          <p className="truncate text-sm font-medium text-fg-strong">
                            {user.name}
                          </p>
                        )}
                        {user?.email && (
                          <p className="truncate text-xs text-fg-muted">
                            {user.email}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <DropdownMenu.Item
                    onSelect={handleLogout}
                    className="m-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-default outline-none data-[highlighted]:bg-fg-strong/[0.06] data-[highlighted]:text-fg-strong"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      </header>

      <Tabs.Root
        value={activeTab}
        onValueChange={handleTabChange}
        className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8"
      >
        <div className="border-b border-line">
          <Tabs.List className="flex gap-1 -mb-px">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <Tabs.Trigger
                  key={tab.id}
                  value={tab.id}
                  className={cn(
                    'group relative flex items-center gap-2 border-b-2 px-3 py-3.5 text-[13.5px] font-medium transition-all',
                    isActive
                      ? 'border-accent-500 text-fg-strong'
                      : 'border-transparent text-fg-muted hover:text-fg-default'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 transition-colors',
                      isActive
                        ? 'text-accent-600 dark:text-accent-300'
                        : 'text-fg-subtle group-hover:text-fg-muted'
                    )}
                  />
                  <span>{tab.label}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <Badge
                      className={cn(
                        'ml-0.5 h-[18px] min-w-[18px] px-1 text-[10px] font-bold tabular-nums leading-none border-transparent',
                        isActive
                          ? 'bg-accent-500 text-white'
                          : 'bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300'
                      )}
                    >
                      {tab.badge}
                    </Badge>
                  )}
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        </div>

        <main className="py-8 sm:py-10">
          <Tabs.Content value="dashboard" className="outline-none animate-fade-in">
            <Dashboard
              mailboxId={selectedMailboxId}
              onRefetchMailboxes={refetchMailboxes}
              onOpenDraftForCandidate={openDraftForCandidate}
              onOpenDraft={openDraft}
              onSwitchToDrafts={() => handleTabChange('drafts')}
              onSwitchToCandidates={switchToCandidates}
            />
          </Tabs.Content>
          <Tabs.Content value="drafts" className="outline-none animate-fade-in">
            <EmailDrafts mailboxId={selectedMailboxId} />
          </Tabs.Content>
          <Tabs.Content value="candidates" className="outline-none animate-fade-in">
            <CandidateTable mailboxId={selectedMailboxId} />
          </Tabs.Content>
        </main>
      </Tabs.Root>
    </div>
  );
}
