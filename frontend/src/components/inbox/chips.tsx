import { Eye, Pencil } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ConfidenceLabel, DraftPresenceEntry } from '@/lib/api';
import { labelFor } from '@/lib/inbox';

/** Interested / Unsure / Not interested — words only, semantic colour. */
export function LabelChip({
  classification,
  confidenceLabel,
}: {
  classification: string;
  confidenceLabel?: ConfidenceLabel | null;
}) {
  const label = labelFor(classification, confidenceLabel);
  return (
    <Badge variant={label.tone} data-tone={label.tone}>
      {label.text}
    </Badge>
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** "Sofia editing" / "Sofia viewing" for the first other person on the reply. */
export function PresenceChip({ presence }: { presence: DraftPresenceEntry[] }) {
  const editor = presence.find((p) => p.mode === 'editing') ?? presence[0];
  if (!editor) return null;
  const Icon = editor.mode === 'editing' ? Pencil : Eye;
  return (
    <Badge variant="outline">
      <Icon data-icon="inline-start" />
      {`${firstName(editor.name)} ${editor.mode}`}
    </Badge>
  );
}

export function MailboxChip({ email }: { email: string }) {
  return <Badge variant="secondary">{email.split('@')[0]}</Badge>;
}
