import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-accent-400">
          Error 404
        </p>
        <h1 className="mt-3 font-display text-5xl font-semibold tracking-tight text-white sm:text-6xl">
          Page not found
        </h1>
        <p className="mt-4 max-w-md text-[14px] text-ink-400">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-lg bg-accent-500 px-4 py-2 text-[13.5px] font-medium text-white shadow-glow transition-colors hover:bg-accent-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
