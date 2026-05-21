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
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export type StatusVariant =
  | 'INTERESTED'
  | 'NOT_INTERESTED'
  | 'NEUTRAL'
  | 'PENDING'
  | 'REPLIED'
  | 'NEEDS_REVIEW'
  | 'IGNORED';

interface VariantStyle {
  className: string;
  dotClass: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

// The shadcn Badge supplies the base shape, focus ring, and motion. The
// chromatic classes here paint the status colour on top: light-mode uses the
// darker shade (X-700) so it stays readable on the pale chromatic backdrop,
// dark-mode keeps the softer X-300. NEUTRAL/IGNORED use theme-aware `fg-*`
// tokens so they flip automatically.
const VARIANTS: Record<StatusVariant, VariantStyle> = {
  INTERESTED: {
    className:
      'bg-emerald-500/10 text-emerald-700 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-300 border-transparent',
    dotClass: 'bg-emerald-500 dark:bg-emerald-400',
    icon: CheckCircle2,
    label: 'Interested',
  },
  NOT_INTERESTED: {
    className:
      'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-300 border-transparent',
    dotClass: 'bg-rose-500 dark:bg-rose-400',
    icon: XCircle,
    label: 'Not Interested',
  },
  NEUTRAL: {
    className:
      'bg-fg-strong/[0.05] text-fg-default ring-1 ring-inset ring-fg-strong/[0.08] border-transparent',
    dotClass: 'bg-fg-muted',
    icon: MinusCircle,
    label: 'Neutral',
  },
  PENDING: {
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300 border-transparent',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    icon: Clock,
    label: 'Pending',
  },
  REPLIED: {
    className:
      'bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/20 dark:text-sky-300 border-transparent',
    dotClass: 'bg-sky-500 dark:bg-sky-400',
    icon: Send,
    label: 'Replied',
  },
  NEEDS_REVIEW: {
    className:
      'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-300 border-transparent',
    dotClass: 'bg-amber-500 dark:bg-amber-400',
    icon: AlertTriangle,
    label: 'Needs Review',
  },
  IGNORED: {
    className:
      'bg-fg-strong/[0.04] text-fg-muted ring-1 ring-inset ring-fg-strong/[0.07] border-transparent',
    dotClass: 'bg-fg-subtle',
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
    <Badge
      className={cn(
        // Override shadcn defaults (h-5 fixed, taupe bg) — the chromatic class
        // owns the surface colour and we pick the size locally.
        'h-auto',
        v.className,
        size === 'sm'
          ? 'px-2 py-0.5 text-[11px]'
          : 'px-2.5 py-1 text-xs',
        className
      )}
    >
      {withIcon ? (
        <Icon
          className={cn(
            'flex-shrink-0',
            size === 'sm' ? '!size-3' : '!size-3.5'
          )}
        />
      ) : (
        <span className={cn('size-1.5 rounded-full', v.dotClass)} />
      )}
      {v.label}
    </Badge>
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
    <Badge
      className={cn(
        'h-auto px-2 py-0.5 text-[11px]',
        v.className,
        className
      )}
    >
      <Icon className="!size-3 flex-shrink-0" />
      <span>{v.label}</span>
      {confidence !== undefined && (
        <span className="text-fg-muted tabular-nums font-mono text-[10px]">
          · {Math.round(confidence * 100)}%
        </span>
      )}
    </Badge>
  );
}
