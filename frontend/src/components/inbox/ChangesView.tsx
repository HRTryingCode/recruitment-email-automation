import { cn } from '@/lib/utils';
import { diffWords } from '@/lib/inbox';

/** Word diff of the AI draft (before) against the text that will be sent (after). */
export default function ChangesView({ before, after }: { before: string; after: string }) {
  return (
    <p aria-label="Changes from the AI draft" className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {diffWords(before, after).map((s, i) => (
        <span
          key={i}
          data-op={s.op}
          className={cn(
            s.op === 'add' && 'bg-success/15 text-success',
            s.op === 'del' && 'bg-destructive/10 text-destructive line-through'
          )}
        >
          {s.text}
        </span>
      ))}
    </p>
  );
}
