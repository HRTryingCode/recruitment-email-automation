import { useQuery } from '@tanstack/react-query';
import { fetchDraftCcOptions } from '../../lib/api';
import { initials } from '../../lib/utils';
import QueryError from '../../components/shell/QueryError';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';

/**
 * Read-only team list. The CC options endpoint returns every admin (plus a
 * "No CC" sentinel), which is also who a handoff draft can CC.
 */
export default function TeamSettings() {
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['cc-options', 'team'],
    queryFn: () => fetchDraftCcOptions(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const admins = (data?.data ?? []).filter((o) => o.email);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>Admins — they can manage mailboxes and are the people a handoff draft can CC.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24" />
        ) : isError ? (
          <QueryError thing="the team" onRetry={() => void refetch()} retrying={isFetching} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {admins.map((a) => (
                <TableRow key={a.email}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarFallback>{initials(a.name, a.email ?? undefined)}</AvatarFallback>
                      </Avatar>
                      {a.name}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.email}</TableCell>
                  <TableCell>Admin · CC option</TableCell>
                </TableRow>
              ))}
              {admins.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-muted-foreground">
                    No admins yet. An existing admin or the person who set up this app can make someone an admin.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
