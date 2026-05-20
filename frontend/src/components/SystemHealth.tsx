import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '../lib/api';
import { cn } from '../lib/utils';
import { Database, BrainCircuit, Mail, RefreshCw } from 'lucide-react';

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        'inline-block w-2.5 h-2.5 rounded-full flex-shrink-0',
        ok ? 'bg-green-400' : 'bg-red-400'
      )}
    />
  );
}

const PROVIDER_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  GMAIL: Mail,
  OUTLOOK: Mail,
  IMAP: Mail,
};

export default function SystemHealth() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const health = data?.data;

  const overallColor =
    health?.status === 'healthy'
      ? 'text-green-400'
      : health?.status === 'degraded'
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold">System Health</h2>
        <div className="flex items-center gap-3">
          {health && (
            <span className={cn('text-sm font-medium capitalize', overallColor)}>
              {health.status}
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-800 animate-pulse rounded" />
          ))}
        </div>
      ) : error ? (
        <p className="text-red-400 text-sm">Failed to load health status</p>
      ) : health ? (
        <div className="space-y-3">
          {/* Database */}
          <div className="flex items-center justify-between py-2 border-b border-gray-800">
            <div className="flex items-center gap-2.5">
              <Database className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">Database</span>
            </div>
            <div className="flex items-center gap-2">
              {health.database.latencyMs !== undefined && (
                <span className="text-xs text-gray-500">{health.database.latencyMs}ms</span>
              )}
              <StatusDot ok={health.database.connected} />
            </div>
          </div>

          {/* Claude AI */}
          <div className="flex items-center justify-between py-2 border-b border-gray-800">
            <div className="flex items-center gap-2.5">
              <BrainCircuit className="w-4 h-4 text-gray-400" />
              <span className="text-sm text-gray-300">Claude AI</span>
            </div>
            <StatusDot ok={health.claude.available} />
          </div>

          {/* Mailboxes */}
          {health.mailboxes.map((mb) => {
            const Icon = PROVIDER_ICON[mb.provider] ?? Mail;
            const watchExpired =
              mb.watchExpiry && new Date(mb.watchExpiry) < new Date();
            return (
              <div
                key={mb.id}
                className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
              >
                <div className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 text-gray-400" />
                  <div>
                    <p className="text-sm text-gray-300">{mb.emailAddress}</p>
                    <p className="text-xs text-gray-600">{mb.provider}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {watchExpired && (
                    <span className="text-xs text-yellow-500">Watch expired</span>
                  )}
                  <StatusDot ok={mb.isActive} />
                </div>
              </div>
            );
          })}

          {health.mailboxes.length === 0 && (
            <p className="text-gray-600 text-sm py-2">No mailboxes connected</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
