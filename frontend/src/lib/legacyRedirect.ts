/**
 * Pre-R1 URLs were `/?tab=dashboard|drafts|candidates&…`. Map them (and a
 * bare `/`) onto the new routes, keeping the params the target view reads
 * plus the shell-wide ones (mailbox filter, OAuth callback flags).
 */
const TAB_ROUTES: Record<string, { path: string; keep: string[] }> = {
  dashboard: { path: '/today', keep: [] },
  drafts: { path: '/inbox', keep: ['draftId', 'candidateId', 'status'] },
  candidates: { path: '/candidates', keep: ['filter', 'q', 'lever', 'sort', 'dir'] },
};

// Shell-level params: mailbox filter + Gmail / Gem OAuth callback results.
const SHELL_PARAMS = ['mailboxId', 'mailbox', 'reason', 'gem'];

export function legacyRedirect(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const route = (tab && TAB_ROUTES[tab]) || TAB_ROUTES.drafts;
  const keep = tab && TAB_ROUTES[tab] ? route.keep : [];
  const next = new URLSearchParams();
  for (const [key, value] of params) {
    if (keep.includes(key) || SHELL_PARAMS.includes(key)) next.append(key, value);
  }
  const qs = next.toString();
  return qs ? `${route.path}?${qs}` : route.path;
}
