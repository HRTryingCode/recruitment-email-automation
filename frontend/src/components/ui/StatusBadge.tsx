import { cn } from '../../lib/utils';
import {
  CheckCircle2,
  XCircle,
  Send,
  Clock,
  AlertTriangle,
  MinusCircle,
  EyeOff,
  Sparkles,
} from 'lucide-react';

export type StatusVariant =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'NEUTRAL'
  | 'PENDING'
  | 'REPLIED'
  | 'NEEDS_REVIEW'
  | 'IGNORED';

interface VariantStyle {
  ring: string;
  bg: string;
  text: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

const VARIANTS: Record<StatusVariant, VariantStyle> = {
  INTERESTED: {
    ring: 'ring-emerald-500/20',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    dot: 'bg-emerald-400',
    icon: CheckCircle2,
    label: 'Interested',
  },
  NOT_INTERESTED: {
    ring: 'ring-rose-500/20',
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    dot: 'bg-rose-400',
    icon: XCircle,
    label: 'Not Interested',
  },
  NEUTRAL: {
    ring: 'ring-white/[0.08]',
    bg: 'bg-white/[0.04]',
    text: 'text-ink-200',
    dot: 'bg-ink-400',
    icon: MinusCircle,
    label: 'Neutral',
  },
  PENDING: {
    ring: 'ring-amber-500/20',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
    icon: Clock,
    label: 'Pending',
  },
  REPLIED: {
    ring: 'ring-sky-500/20',
    bg: 'bg-sky-500/10',
    text: 'text-sky-300',
    dot: 'bg-sky-400',
    icon: Send,
    label: 'Replied',
  },
  NEEDS_REVIEW: {
    ring: 'ring-amber-500/25',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    dot: 'bg-amber-400',
    icon: AlertTriangle,
    label: 'Needs Review',
  },
  IGNORED: {
    ring: 'ring-white/[0.06]',
    bg: 'bg-white/[0.03]',
    text: 'text-ink-400',
    dot: 'bg-ink-500',
    icon: EyeOff,
    label: 'Ignored',
  },
};

interface Props {
  status: StatusVariant;
  size?: 'sm' | 'md';
  withIcon?: boolean;
  className?: string;
}

export function StatusBadge({
  status,
  size = 'sm',
  withIcon = true,
  className,
}: Props) {
  const v = VARIANTS[status] ?? VARIANTS.NEUTRAL;
  const Icon = v.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset',
        v.bg,
        v.text,
        v.ring,
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {withIcon ? (
        <Icon className={cn(size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5')} />
      ) : (
        <span className={cn('h-1.5 w-1.5 rounded-full', v.dot)} />
      )}
      {v.label}
    </span>
  );
}

interface ClassificationBadgeProps {
  classification: 'INTERESTED' | 'NOT_INTERESTED' | 'NEUTRAL';
  confidence?: number;
  className?: string;
}

export function ClassificationBadge({
  classification,
  confidence,
  className,
}: ClassificationBadgeProps) {
  const v = VARIANTS[classification];
  const Icon = classification === 'NEUTRAL' ? Sparkles : v.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        v.bg,
        v.text,
        v.ring,
        className
      )}
    >
      <Icon className="h-3 w-3" />
      <span>{v.label}</span>
      {confidence !== undefined && (
        <span className="text-ink-400 tabular-nums font-mono text-[10px]">
          · {Math.round(confidence * 100)}%
        </span>
      )}
    </span>
  );
}
