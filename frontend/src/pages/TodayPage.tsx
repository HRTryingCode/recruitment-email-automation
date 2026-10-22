import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Dashboard from '../components/Dashboard';
import { useMailboxFilter, viewHref } from '../lib/urlState';

// R4 turns this into the small "Today" strip.
export default function TodayPage() {
  const [mailboxId] = useMailboxFilter();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const go = (path: string, extra?: Record<string, string | undefined>) => navigate(viewHref(path, params, extra));

  return (
    <Dashboard
      mailboxId={mailboxId}
      onRefetchMailboxes={() => void queryClient.invalidateQueries({ queryKey: ['mailboxes'] })}
      onOpenDraftForCandidate={(candidateId) => go('/inbox', { candidateId })}
      onOpenDraft={(draftId) => go('/inbox', { draftId })}
      onSwitchToDrafts={() => go('/inbox')}
      onSwitchToCandidates={(filter) => go('/candidates', { filter })}
    />
  );
}
