import { highlightSegments } from '@/lib/inbox';

/** The candidate's message with the classifier's evidence quote highlighted. */
export default function EvidenceMessage({ body, quote }: { body: string; quote?: string | null }) {
  if (!body.trim()) return <p className="text-sm italic text-muted-foreground">(no message body)</p>;
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
      {highlightSegments(body, quote).map((s, i) =>
        s.mark ? (
          <mark key={i} className="bg-warning/25 text-foreground">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        )
      )}
    </p>
  );
}
