import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Sparkles } from 'lucide-react';
import { loginWithGoogle } from '../lib/api';
import { safeNextPath, setToken, setUser } from '../lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { currentTheme } from '../lib/shortcuts';

const GOOGLE_CLIENT_ID =
  '403302601606-m9l02nom1med5ok7bh6rign6a3hk01o3.apps.googleusercontent.com';

export default function Login() {
  const navigate = useNavigate();
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gisReady, setGisReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let intervalId: number | null = null;

    const tryInit = () => {
      const gis = window.google?.accounts?.id;
      if (!gis || !btnRef.current || cancelled) return false;

      gis.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          setError(null);
          try {
            const { token, user } = await loginWithGoogle(credential);
            setToken(token);
            setUser(user);
            navigate(safeNextPath(window.location.search), { replace: true });
          } catch (err) {
            let message = 'Google sign-in failed. Please try again.';
            if (axios.isAxiosError(err)) {
              const data = err.response?.data as
                | { message?: string; error?: string }
                | undefined;
              message = data?.message ?? data?.error ?? message;
            }
            setError(message);
          }
        },
        auto_select: false,
        use_fedcm_for_prompt: true,
        hd: 'archive.com',
      });

      gis.renderButton(btnRef.current, {
        theme: currentTheme() === 'dark' ? 'filled_black' : 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
        shape: 'rectangular',
      });

      setGisReady(true);
      return true;
    };

    if (!tryInit()) {
      intervalId = window.setInterval(() => {
        if (tryInit() && intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }, 150);
    }

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center justify-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-primary text-primary-foreground">
              <Sparkles className="size-5" />
            </AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-lg font-semibold leading-none tracking-tight">Archive Recruiting</h1>
            <p className="mt-1 text-xs text-muted-foreground">AI email automation</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-xl font-semibold tracking-tight">Welcome back</h2>
            </CardTitle>
            <CardDescription>Sign in with your Archive Google account to continue.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex justify-center">
              <div ref={btnRef} />
            </div>

            {!gisReady && (
              <p className="text-center text-xs text-muted-foreground">Loading Google sign-in…</p>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Restricted to <span className="font-mono">@archive.com</span> accounts.
        </p>
      </div>
    </div>
  );
}
