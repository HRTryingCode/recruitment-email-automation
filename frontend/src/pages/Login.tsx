import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Sparkles } from 'lucide-react';
import { loginWithGoogle } from '../lib/api';
import { setToken, setUser } from '../lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

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
            navigate('/', { replace: true });
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
        theme: 'filled_blue',
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
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="absolute inset-0 -z-10 grid-bg opacity-60" />
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center justify-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-accent-500/40 blur-xl" />
            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 via-accent-500 to-accent-700 ring-1 ring-white/15">
              <Sparkles className="h-5 w-5 text-white" strokeWidth={2.4} />
            </div>
          </div>
          <div>
            <h1 className="font-display text-xl font-semibold leading-none text-fg-strong tracking-tight">
              Archive Recruiting
            </h1>
            <p className="mt-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-fg-muted">
              AI Email Automation
            </p>
          </div>
        </div>

        <Card className="border border-line bg-surface-raised/70 backdrop-blur-xl shadow-2xl">
          <CardHeader>
            <CardTitle>
              <h2 className="font-display text-2xl font-semibold tracking-tight text-fg-strong">
                Welcome back
              </h2>
            </CardTitle>
            <CardDescription className="text-[13.5px] leading-relaxed text-fg-muted">
              Sign in with your Archive Google account to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex justify-center">
              <div ref={btnRef} />
            </div>

            {!gisReady && (
              <p className="text-center text-[12px] text-fg-subtle">
                Loading Google sign-in…
              </p>
            )}

            {error && (
              <Alert
                variant="destructive"
                className="border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
              >
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-[12px] text-fg-subtle">
          Restricted to <span className="font-mono text-fg-muted">@archive.com</span> accounts.
        </p>
      </div>
    </div>
  );
}
