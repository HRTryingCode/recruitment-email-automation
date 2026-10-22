/**
 * Sender identity helpers (audit M11 / H2).
 *
 * A mailbox "owns" its primary address plus every Gmail sendAs alias stored on
 * Mailbox.sendAsAddresses (refreshed from users.settings.sendAs.list). Gem
 * sequences are often sent from an executive alias (e.g. ethan@ delivered into
 * emaenza@), so exact-address equality against Mailbox.emailAddress misses
 * outbound mail and turns colleagues into candidates.
 *
 * Pure functions only — no Prisma, no Gmail — so gmail.service and
 * coverage.service can both use them without an import cycle.
 */

export function normalizeEmail(address: string): string {
  return address.trim().toLowerCase();
}

export interface MailboxIdentity {
  emailAddress: string;
  sendAsAddresses?: string[] | null;
}

/** Primary address first, then aliases; normalized and deduped. */
export function mailboxOwnAddresses(mailbox: MailboxIdentity): string[] {
  const out = new Set<string>([normalizeEmail(mailbox.emailAddress)]);
  for (const alias of mailbox.sendAsAddresses ?? []) {
    const n = normalizeEmail(alias);
    if (n) out.add(n);
  }
  return [...out];
}

export function isMailboxOwnAddress(mailbox: MailboxIdentity, address: string): boolean {
  const n = normalizeEmail(address);
  if (!n) return false;
  return mailboxOwnAddresses(mailbox).includes(n);
}

/** True when the address's domain is exactly one of `internalDomains`. */
export function isInternalAddress(address: string, internalDomains: string[]): boolean {
  const n = normalizeEmail(address);
  const at = n.lastIndexOf('@');
  if (at < 0) return false;
  const domain = n.slice(at + 1);
  return internalDomains.some((d) => normalizeEmail(d) === domain);
}

/** Map a Gmail users.settings.sendAs.list response to normalized addresses. */
export function sendAsEmailsFromGmail(
  sendAs: Array<{ sendAsEmail?: string | null; isPrimary?: boolean | null }> | undefined
): string[] {
  const out: string[] = [];
  for (const s of sendAs ?? []) {
    const n = s.sendAsEmail ? normalizeEmail(s.sendAsEmail) : '';
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
