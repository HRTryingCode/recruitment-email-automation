import { useEffect, useState } from 'react';
import { toast } from 'sonner';

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return <span>{left > 0 ? `Sends in ${left}s` : 'Sending…'}</span>;
}

/** "Sending to <name> · Undo" with a live countdown for the undo window. */
export function showUndoToast(opts: { title: string; seconds: number; onUndo: () => void }): string | number {
  return toast(opts.title, {
    description: <Countdown seconds={opts.seconds} />,
    duration: opts.seconds * 1000,
    action: { label: 'Undo', onClick: opts.onUndo },
  });
}

export function dismissUndoToast(id: string | number): void {
  toast.dismiss(id);
}
