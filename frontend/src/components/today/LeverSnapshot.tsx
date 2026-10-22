import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import type { TodaySummary } from '../../lib/api';
import { viewHref } from '../../lib/urlState';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Separator } from '../ui/separator';
import { Skeleton } from '../ui/skeleton';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export default function LeverSnapshot({ summary, params }: { summary: TodaySummary | undefined; params: URLSearchParams }) {
  const lever = summary?.lever;
  // The Candidates saved view for "Interested, not in Lever" (R3 reads status + lever).
  const notInLeverHref = viewHref('/candidates', params, { status: 'INTERESTED', lever: 'NOT_IN' });

  return (
    <Card role="region" aria-label="Lever" className="min-w-0">
      <CardHeader>
        <CardTitle>Lever</CardTitle>
        <CardDescription>Interested candidates still to add, and what was added.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!lever ? (
          <Skeleton data-testid="today-skeleton" className="h-24" />
        ) : (
          <>
            <Button asChild variant="outline" className="h-auto justify-between py-3">
              <Link to={notInLeverHref}>
                <span className="flex flex-col items-start">
                  <span className="text-xs text-muted-foreground">Interested, not in Lever</span>
                  <span className="text-2xl font-semibold tabular-nums">{lever.interestedNotInLever}</span>
                </span>
                <ChevronRight data-icon="inline-end" />
              </Link>
            </Button>
            <Separator />
            <Stat label="Added today" value={lever.addedToday} />
            <Stat label="Added this week" value={lever.addedThisWeek} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
