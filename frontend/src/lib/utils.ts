import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimeAgo(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Compact age: "now", "45m", "5h", "3d". `withHours` (Today's tiles) keeps
 * the hours past a day ("2d 4h") and reads "< 1m" instead of "now".
 */
export function formatAge(ms: number, { withHours = false }: { withHours?: boolean } = {}): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return withHours ? '< 1m' : 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return withHours && rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Avatar fallback: up to two initials from the name, else the email, else "?". */
export function initials(name?: string, email?: string): string {
  const seed = (name?.trim() || email?.trim() || '?').trim();
  return (
    seed
      .split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}
