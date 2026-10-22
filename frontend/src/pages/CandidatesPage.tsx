import CandidateTable from '../components/CandidateTable';
import { useMailboxFilter } from '../lib/urlState';

export default function CandidatesPage() {
  const [mailboxId] = useMailboxFilter();
  return <CandidateTable mailboxId={mailboxId} />;
}
