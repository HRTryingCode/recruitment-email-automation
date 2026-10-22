import { useQuery } from '@tanstack/react-query';
import { fetchLeverMe } from '../../lib/leverApi';
import GemConnect from '../../components/GemConnect';
import QueryError from '../../components/shell/QueryError';
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

/** Plain-language "what this means and who can fix it" under a status row. */
function Note({ children }: { children: React.ReactNode }) {
  return <p className="pb-1.5 text-sm text-muted-foreground">{children}</p>;
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
          <CardDescription>Set up by an admin for the whole team. You can see the status here, but not change it.</CardDescription>
        </CardHeader>
        <CardContent>
          {lever.isLoading ? (
            <Skeleton className="h-16" />
          ) : lever.isError || !me ? (
            <QueryError thing="the Lever status" onRetry={() => void lever.refetch()} retrying={lever.isFetching} />
          ) : (
            <div className="flex flex-col">
              <Row label="Connection">
                <Badge variant={me.configured ? 'success' : 'secondary'}>{me.configured ? 'Connected' : 'Not connected'}</Badge>
              </Row>
              {!me.configured && <Note>Lever isn't connected. An admin needs to add the Lever API key in Vercel.</Note>}
              <Row label="Add to Lever">
                <Badge variant={me.createEnabled ? 'success' : 'secondary'}>{me.createEnabled ? 'On' : 'Off'}</Badge>
              </Row>
              {me.configured && !me.createEnabled && (
                <Note>
                  The Add to Lever button is hidden for everyone. An admin needs to turn it on in Vercel.
                </Note>
              )}
              {me.leverUser && <Row label="Your Lever user">{me.leverUser.name ?? me.leverUser.id}</Row>}
              {me.configured && !me.leverUser && me.appEmail && (
                <Note>
                  No Lever user matches {me.appEmail}, so candidates you add can't be credited to you. Ask a Lever admin to
                  add this email to your Lever account.
                </Note>
              )}
              {me.appEmail && <Row label="Signed in as">{me.appEmail}</Row>}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
