import { useQuery } from '@tanstack/react-query';
import { fetchCandidates, fetchDrafts } from '../lib/api';
import SystemHealth from './SystemHealth';
import RecentActivity from './RecentActivity';
import { Users, TrendingUp, Clock, FileText } from 'lucide-react';

interface Props {
  mailboxId?: string;
  onRefetchMailboxes: () => void;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  loading?: boolean;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm">{label}</p>
          {loading ? (
            <div className="mt-2 h-8 w-16 bg-gray-800 animate-pulse rounded" />
          ) : (
            <p className="text-3xl font-bold text-white mt-1">{value}</p>
          )}
        </div>
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function PipelineBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-400">{label}</span>
        <span className="text-gray-300 font-medium">{count}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function Dashboard({ mailboxId }: Props) {
  const { data: candidatesData, isLoading: loadingCandidates } = useQuery({
    queryKey: ['candidates', { mailboxId }],
    queryFn: () => fetchCandidates({ mailboxId, limit: 1000 }),
    staleTime: 30_000,
  });

  const { data: draftsData, isLoading: loadingDrafts } = useQuery({
    queryKey: ['drafts', 'PENDING'],
    queryFn: () => fetchDrafts({ status: 'PENDING', limit: 1000 }),
    staleTime: 30_000,
  });

  const candidates = candidatesData?.data ?? [];
  const total = candidatesData?.meta.total ?? 0;

  const counts = {
    total,
    interested: candidates.filter((c) => c.status === 'INTERESTED').length,
    pending: candidates.filter((c) => c.status === 'PENDING').length,
    notInterested: candidates.filter((c) => c.status === 'NOT_INTERESTED').length,
    neutral: candidates.filter((c) => c.status === 'NEUTRAL').length,
    replied: candidates.filter((c) => c.status === 'REPLIED').length,
  };

  const pendingDrafts = draftsData?.meta.total ?? 0;

  return (
    <div className="space-y-6">
      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Candidates"
          value={counts.total}
          icon={Users}
          color="bg-blue-600"
          loading={loadingCandidates}
        />
        <MetricCard
          label="Interested"
          value={counts.interested}
          icon={TrendingUp}
          color="bg-green-600"
          loading={loadingCandidates}
        />
        <MetricCard
          label="Pending Review"
          value={counts.pending}
          icon={Clock}
          color="bg-yellow-600"
          loading={loadingCandidates}
        />
        <MetricCard
          label="Drafts Ready"
          value={pendingDrafts}
          icon={FileText}
          color="bg-purple-600"
          loading={loadingDrafts}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipeline */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="text-white font-semibold mb-4">Pipeline Status</h2>
          <div className="space-y-3">
            <PipelineBar
              label="Interested"
              count={counts.interested}
              total={counts.total}
              color="bg-green-500"
            />
            <PipelineBar
              label="Neutral"
              count={counts.neutral}
              total={counts.total}
              color="bg-gray-500"
            />
            <PipelineBar
              label="Not Interested"
              count={counts.notInterested}
              total={counts.total}
              color="bg-red-500"
            />
            <PipelineBar
              label="Pending"
              count={counts.pending}
              total={counts.total}
              color="bg-yellow-500"
            />
            <PipelineBar
              label="Replied"
              count={counts.replied}
              total={counts.total}
              color="bg-blue-500"
            />
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2">
          <RecentActivity />
        </div>
      </div>

      {/* System Health */}
      <SystemHealth />
    </div>
  );
}
