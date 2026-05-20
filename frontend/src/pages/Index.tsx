import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchMailboxes, addGmailMailbox, fetchDrafts } from '../lib/api';
import Dashboard from '../components/Dashboard';
import EmailDrafts from '../components/EmailDrafts';
import CandidateTable from '../components/CandidateTable';
import MailboxFilter from '../components/MailboxFilter';
import { cn } from '../lib/utils';
import { BrainCircuit, Plus } from 'lucide-react';

type Tab = 'dashboard' | 'drafts' | 'candidates';

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [selectedMailboxId, setSelectedMailboxId] = useState<string | undefined>();

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

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'drafts', label: 'Email Drafts', badge: pendingDraftCount > 0 ? pendingDraftCount : undefined },
    { id: 'candidates', label: 'Candidates' },
  ];

  return (
    <div className="min-h-screen bg-gray-950">
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
