import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { TodaySummary } from '../../lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '../ui/chart';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

// The taupe chart ramp is near-grey by design (R1), so the two series are
// told apart by lightness (ΔE ≥ 18 in both modes) plus legend, tooltip and
// the screen-reader table below — never by hue alone.
const config = {
  received: { label: 'Replies received', theme: { light: 'var(--chart-2)', dark: 'var(--chart-1)' } },
  sent: { label: 'Replies sent', theme: { light: 'var(--chart-4)', dark: 'var(--chart-2)' } },
} satisfies ChartConfig;

/** "2026-10-22" → "Oct 22" (the day is already an ET calendar date). */
function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function ActivityChart({ summary }: { summary: TodaySummary | undefined }) {
  const series = summary?.series ?? [];
  const received = series.reduce((n, d) => n + d.received, 0);
  const sent = series.reduce((n, d) => n + d.sent, 0);
  const data = series.map((d) => ({ ...d, label: dayLabel(d.day) }));

  return (
    <Card role="region" aria-label="Last 14 days">
      <CardHeader>
        <CardTitle>Last 14 days</CardTitle>
        <CardDescription>
          {summary ? `${received} received · ${sent} sent` : 'Candidate replies received vs replies sent'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!summary ? (
          <Skeleton data-testid="today-skeleton" className="h-48" />
        ) : received + sent === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BarChart3 />
              </EmptyMedia>
              <EmptyTitle>No activity in the last 14 days</EmptyTitle>
              <EmptyDescription>Candidate replies and sent replies will show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <ChartContainer config={config} className="aspect-auto h-48 w-full" aria-hidden>
              <BarChart data={data} barGap={2} margin={{ left: -16, right: 4 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={16} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="received" fill="var(--color-received)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sent" fill="var(--color-sent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <div className="sr-only">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Replies received</TableHead>
                    <TableHead>Replies sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell>{d.label}</TableCell>
                      <TableCell>{d.received}</TableCell>
                      <TableCell>{d.sent}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
