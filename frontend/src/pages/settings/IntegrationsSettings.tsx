import { useQuery } from '@tanstack/react-query';
import { fetchLeverMe } from '../../lib/leverApi';
import GemConnect from '../../components/GemConnect';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  );
}

export default function IntegrationsSettings() {
  const lever = useQuery({ queryKey: ['lever-me'], queryFn: fetchLeverMe, staleTime: 5 * 60_000, retry: false });
  const me = lever.data;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Gem</CardTitle>
          <CardDescription>Your own Gem account, used to prefill Add to Lever.</CardDescription>
        </CardHeader>
        <CardContent>
          <GemConnect />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lever</CardTitle>
          <CardDescription>Read-only. Configured by an admin via environment settings.</CardDescription>
        </CardHeader>
        <CardContent>
          {lever.isLoading ? (
            <Skeleton className="h-16" />
          ) : lever.isError || !me ? (
            <p className="text-sm text-muted-foreground">Could not load the Lever status.</p>
          ) : (
            <div className="flex flex-col">
              <Row label="Connection">
                <Badge variant={me.configured ? 'success' : 'secondary'}>{me.configured ? 'Configured' : 'Not configured'}</Badge>
              </Row>
              <Row label="Add to Lever">
                <Badge variant={me.createEnabled ? 'success' : 'secondary'}>{me.createEnabled ? 'Enabled' : 'Disabled'}</Badge>
              </Row>
              {me.leverUser && <Row label="Your Lever user">{me.leverUser.name ?? me.leverUser.id}</Row>}
              {me.appEmail && <Row label="Signed in as">{me.appEmail}</Row>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
