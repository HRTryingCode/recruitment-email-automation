import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

interface Props {
  title: string;
  description?: ReactNode;
  /** Page-level buttons, right-aligned (wrap under the title on phones). */
  actions?: ReactNode;
  /** Keep the h1 for screen readers only (full-bleed pages like the Inbox). */
  srOnly?: boolean;
  className?: string;
}

/** The page's one h1 + description + actions (Candidates, Today, Settings). */
export default function PageHeader({ title, description, actions, srOnly, className }: Props) {
  if (srOnly) return <h1 className="sr-only">{title}</h1>;
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
