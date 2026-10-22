import type { LookupIntegrationsData } from '../lib/api';

interface Props {
  data: LookupIntegrationsData;
}

/**
 * External-system status for a looked-up email (Lever lands here in F2).
 * F1 only reserves the slot: the API returns `integrations: {}` and this
 * renders an empty container so F2 can fill it without touching LookupBar.
 */
export default function LookupIntegrations({ data }: Props) {
  const hasAny = Object.keys(data).length > 0;
  return (
    <section
      data-testid="lookup-integrations"
      aria-label="Integrations"
      hidden={!hasAny}
    />
  );
}
