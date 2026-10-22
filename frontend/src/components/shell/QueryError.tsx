import type { ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '../ui/alert';
import { Button } from '../ui/button';

interface Props {
  /** What failed, as the end of "Couldn't load …" ("today's summary", "the team"). */
  thing: string;
  description?: ReactNode;
  onRetry: () => void;
  /** A refetch is in flight: Retry is disabled. */
  retrying?: boolean;
  className?: string;
}

/** The one failed-query message: "Couldn't load <thing>", why, and Retry. */
export default function QueryError({
  thing,
  description = 'Something went wrong on our side. Try again in a moment.',
  onRetry,
  retrying,
  className,
}: Props) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertTitle>{`Couldn't load ${thing}`}</AlertTitle>
      <AlertDescription>{description}</AlertDescription>
      <AlertAction>
        <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
          <RefreshCw data-icon="inline-start" />
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
