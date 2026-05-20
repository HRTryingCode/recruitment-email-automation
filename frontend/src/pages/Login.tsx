import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { BrainCircuit } from 'lucide-react';
import { loginWithGoogle } from '../lib/api';
import { setToken, setUser } from '../lib/auth';

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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-8">
          <BrainCircuit className="w-9 h-9 text-blue-400" />
          <div>
            <h1 className="text-white font-semibold text-xl leading-none">
              Archive Recruiting AI
            </h1>
            <p className="text-gray-500 text-xs mt-1">Email Automation System</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-xl">
          <h2 className="text-white text-2xl font-semibold mb-1">Welcome</h2>
          <p className="text-gray-400 text-sm mb-6">
            Sign in with your Google account to continue.
          </p>

          <div className="flex justify-center">
            <div ref={btnRef} />
          </div>

          {!gisReady && (
            <p className="mt-4 text-center text-xs text-gray-500">
              Loading Google sign-in…
            </p>
          )}

          {error && (
            <div className="mt-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
