// One LinkedIn URL rule for Gem values, stored candidate URLs and what the
// recruiter types into Add to Lever. Mirrored in
// frontend/src/lib/linkedin.ts; both run the vectors in ./linkedin.cases.ts.

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Canonical `https://www.linkedin.com/<path>` for anything that is really a
 * linkedin.com (or *.linkedin.com) page, else null. Gem returns profile URLs
 * without a scheme ("www.linkedin.com/in/…"), so a bare host gets https://;
 * http is upgraded; query and fragment (tracking params) are dropped; the
 * path is kept as is. Other schemes, other hosts, credentials, ports and a
 * bare domain with no page are rejected.
 */
export function normalizeLinkedinUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^https?:\/\//i.test(s)) {
    // "linkedin.com:443/…" is a port, not a scheme; anything else with a
    // scheme (javascript:, ftp:, mailto:) is not a LinkedIn page.
    if (SCHEME.test(s) && !/^[^/:]+:\d+(\/|$)/.test(s)) return null;
    s = `https://${s}`;
  }
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  if (u.pathname === '/' || u.pathname === '') return null;
  return `https://www.linkedin.com${u.pathname}`;
}
