import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Send, X } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { fetchDraftCcOptions } from '@/lib/api';
import { VIEWS, draftedLine } from '@/lib/inbox';
import type { TriageResult } from '@/hooks/useTriageDraft';

interface Props {
  result: TriageResult;
  onReview: () => void;
  /** Hidden once the list already shows the draft's view. */
  onGo?: () => void;
  onDismiss: () => void;
}

/** "Reply drafted · moved to Interested": where a triage draft went and what it is (H8). */
export default function DraftedBanner({ result, onReview, onGo, onDismiss }: Props) {
  const { draft, mailbox } = result;
  // Same key as the reply pane's send line, so this is usually cached.
  const { data } = useQuery({
    queryKey: ['draft-cc-options', draft.id],
    queryFn: () => fetchDraftCcOptions(draft.id),
    staleTime: 5 * 60 * 1000,
    enabled: !!draft.ccEmail,
  });
  const cc = draft.ccEmail?.toLowerCase();
  const opt = data?.data.find((o) => o.email?.toLowerCase() === cc);
  const label = VIEWS.find((v) => v.id === result.view)!.label;
  const title = `Reply drafted · moved to ${label}`;

  return (
    <Alert variant="success" aria-label={title}>
      <CircleCheck />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{draftedLine({ classification: draft.classification, mailbox, ccEmail: draft.ccEmail, ccFirstName: opt?.firstName })}</span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onReview}>
            <Send data-icon="inline-start" />
            Review & send
          </Button>
          {onGo && (
            <Button size="sm" variant="outline" onClick={onGo}>
              {`Go to ${label}`}
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </span>
      </AlertDescription>
      <AlertAction>
        <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
          <X />
        </Button>
      </AlertAction>
    </Alert>
  );
}
