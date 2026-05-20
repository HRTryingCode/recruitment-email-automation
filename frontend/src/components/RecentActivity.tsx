import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';
import { formatTimeAgo } from '../lib/utils';
import { Activity, CheckCircle, AlertCircle, Info } from 'lucide-react';

const LEVEL_ICONS = {
  INFO: Info,
  WARN: AlertCircle,
  ERROR: AlertCircle,
};

const LEVEL_COLORS = {
  INFO: 'text-blue-400',
  WARN: 'text-yellow-400',
  ERROR: 'text-red-400',
};

const EVENT_LABELS: Record<string, string> = {
  MAILBOX_CONNECTED: 'Mailbox connected',
  MAILBOX_DISCONNECTED: 'Mailbox disconnected',
  MAILBOX_SYNCED: 'Mailbox synced',
  GMAIL_WATCH_SET: 'Gmail watch configured',
  DRAFT_CREATED: 'Draft created by AI',
  DRAFT_APPROVED: 'Draft approved',
  DRAFT_DISCARDED: 'Draft discarded',
  DRAFT_SENT: 'Email sent',
};

export default function RecentActivity() {
  const { data, isLoading } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const logs = data?.data.recentLogs ?? [];

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 h-full">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-gray-400" />
        <h2 className="text-white font-semibold">Recent Activity</h2>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-5 h-5 bg-gray-800 animate-pulse rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-3 bg-gray-800 animate-pulse rounded w-3/4" />
                <div className="h-2.5 bg-gray-800 animate-pulse rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <CheckCircle className="w-8 h-8 text-gray-700 mb-2" />
          <p className="text-gray-600 text-sm">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
          {logs.map((log) => {
            const level = log.level as keyof typeof LEVEL_ICONS;
            const Icon = LEVEL_ICONS[level] ?? Info;
            const colorClass = LEVEL_COLORS[level] ?? 'text-gray-400';
            const label = EVENT_LABELS[log.event] ?? log.event;

            return (
              <div key={log.id} className="flex items-start gap-3">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${colorClass}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-300 truncate">{label}</p>
                  <p className="text-xs text-gray-600">{formatTimeAgo(log.createdAt)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
