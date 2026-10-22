import { Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getMe } from '../lib/api';
import { getToken, setUser } from '../lib/auth';
import { Spinner } from './ui/spinner';

export default function ProtectedRoute() {
  const hasToken = !!getToken();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const user = await getMe();
      setUser(user);
      return user;
    },
    enabled: hasToken,
    retry: false,
    staleTime: 5 * 60_000,
  });

  if (!hasToken) {
    return <Navigate to="/login" replace />;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
        <Spinner />
        Loading…
      </div>
    );
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
