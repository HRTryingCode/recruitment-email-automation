import type { LookupIntegrationsData } from '../lib/api';
import { LeverLookupPanel } from './LeverBadge';

interface Props {
  data: LookupIntegrationsData;
}

/**
 * External-system status for a looked-up email, one row per configured
 * integration (Lever: F2, read-only). Hidden when none is configured.
 */
export default function LookupIntegrations({ data }: Props) {
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
          <div className="min-w-0">
            <LeverLookupPanel integration={data.lever} />
          </div>
        </div>
      )}
    </section>
  );
}
