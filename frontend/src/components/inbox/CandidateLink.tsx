import { Link, useSearchParams } from 'react-router-dom';
import { viewHref } from '@/lib/urlState';

/** The candidate's name as a link to their side panel on Candidates. */
export default function CandidateLink({ id, name }: { id?: string | null; name: string }) {
  const [params] = useSearchParams();
  if (!id) return <>{name}</>;
  return (
    <Link
      to={viewHref('/candidates', params, { candidate: id })}
      className="underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}
