// Who may sign in, who is an admin, and which Google accounts may be
// connected as mailboxes (audit B6 / M9, L6, L8). Env vars are read per call
// so a Vercel env change takes effect on the next cold start without code
// changes, and so tests can flip them.

export const COMPANY_DOMAIN = 'archive.com';

function parseList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/** True when `email` is an address on the company domain. */
export function isCompanyEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${COMPANY_DOMAIN}`);
}

/**
 * ADMIN_EMAILS: comma-separated emails promoted to `admin` on sign-in. No
 * default — an unset var promotes nobody (existing admins keep their DB role).
 */
export function adminEmails(): string[] {
  return parseList(process.env.ADMIN_EMAILS);
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

/**
 * ALLOWED_USERS: optional comma-separated sign-in allowlist. Unset/empty means
 * any verified company Workspace account may sign in (the pre-B6 behaviour,
 * plus the `hd` check). ADMIN_EMAILS members are always allowed.
 */
export function allowedUsers(): string[] {
  return parseList(process.env.ALLOWED_USERS);
}

export type LoginDecision =
  | { allowed: true }
  | { allowed: false; reason: 'domain' | 'not-allowlisted' };

/**
 * `hd` is the Google Workspace hosted-domain claim. Checking it (not just the
 * email suffix) rejects consumer Google accounts registered with a company
 * address.
 */
export function checkLogin(email: string, hd: string | undefined): LoginDecision {
  const normalized = email.trim().toLowerCase();
  if (!isCompanyEmail(normalized) || (hd ?? '').toLowerCase() !== COMPANY_DOMAIN) {
    return { allowed: false, reason: 'domain' };
  }
  const allow = allowedUsers();
  if (allow.length > 0 && !allow.includes(normalized) && !isAdminEmail(normalized)) {
    return { allowed: false, reason: 'not-allowlisted' };
  }
  return { allowed: true };
}
