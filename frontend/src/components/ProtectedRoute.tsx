import { Navigate, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { getMe } from '../lib/api';
import { getToken, setUser } from '../lib/auth';

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
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 text-fg-muted">
          <Loader2 className="h-5 w-5 animate-spin text-accent-400" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
