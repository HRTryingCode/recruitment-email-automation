import type { LookupIntegrationsData } from '../lib/api';
import { LeverLookupPanel } from './LeverBadge';
import AddToLeverButton from './AddToLeverButton';

interface Props {
  data: LookupIntegrationsData;
  /** Looked-up address; enables F3 "Add to Lever" for people not in Lever. */
  email?: string;
  /** Candidate row for this address, if the app knows them. */
  candidateId?: string | null;
}

/**
 * External-system status for a looked-up email, one row per configured
 * integration (Lever: F2 status, F3 Add to Lever). Hidden when none is configured.
 */
export default function LookupIntegrations({ data, email, candidateId }: Props) {
  const hasAny = Object.keys(data).length > 0;
  return (
    <section
      data-testid="lookup-integrations"
      aria-label="Integrations"
      hidden={!hasAny}
      className="text-[13px]"
    >
      {data.lever && (
        <div className="flex min-w-0 gap-3 py-1">
          <span className="w-24 flex-shrink-0 text-fg-muted">Lever</span>
          <div className="min-w-0 space-y-1.5">
            <LeverLookupPanel integration={data.lever} />
            {email && data.lever.status !== 'ERROR' && (
              <AddToLeverButton
                target={candidateId ? { candidateId } : { email }}
                inLever={data.lever.status === 'FOUND'}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
