// Per-draft CC (F4). EmailDraft.ccEmail stores the CC a draft goes out with:
// NULL = a pre-F4 draft, fall back to the configured default (DRAFT_CC_EMAIL);
// NO_CC ('') = the recruiter chose "No CC"; otherwise the address.
import { prisma } from '../db/client';
import { config } from '../config';
import { adminEmails } from '../lib/accessPolicy';

export const NO_CC = '';

export interface CcOption {
  email: string;
  name: string;
  firstName: string;
}

function localPart(email: string): string {
  return email.split('@')[0] ?? email;
}

function firstNameOf(name: string | null | undefined, email: string): string {
  const fromName = (name ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const token = localPart(email).split(/[._+-]/)[0] ?? '';
  return token ? token[0].toUpperCase() + token.slice(1) : email;
}

/**
 * Everyone a draft may CC: admin users ∪ ADMIN_EMAILS ∪ the configured
 * default, deduped case-insensitively and sorted by name. `excludeEmail`
 * (the draft's mailbox owner) is left out — a mailbox never CCs itself.
 */
export async function listCcOptions(opts: { excludeEmail?: string } = {}): Promise<CcOption[]> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin' },
    select: { email: true, name: true },
  });
  const nameByEmail = new Map<string, string | null>();
  for (const u of admins) nameByEmail.set(u.email.trim().toLowerCase(), u.name ?? null);
  for (const e of [...adminEmails(), config.draftCcEmail.trim().toLowerCase()]) {
    if (e && !nameByEmail.has(e)) nameByEmail.set(e, null);
  }
  const exclude = opts.excludeEmail?.trim().toLowerCase();
  if (exclude) nameByEmail.delete(exclude);

  const emails = [...nameByEmail.keys()];
  const mailboxes = emails.length
    ? await prisma.mailbox.findMany({
        where: { emailAddress: { in: emails } },
        select: { emailAddress: true, displayName: true },
      })
    : [];
  const displayByEmail = new Map(
    mailboxes.map((m) => [m.emailAddress.toLowerCase(), m.displayName?.trim() || null])
  );

  return emails
    .map((email) => {
      const name = nameByEmail.get(email)?.trim() || displayByEmail.get(email) || localPart(email);
      return { email, name, firstName: firstNameOf(name === localPart(email) ? null : name, email) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** First name the hand-off body uses for a CC address ("Sofia", not "Sofia Delgado"). */
export async function ccFirstName(email: string): Promise<string> {
  const addr = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: addr }, select: { name: true } });
  if (user?.name?.trim()) return firstNameOf(user.name, addr);
  const mailbox = await prisma.mailbox.findUnique({
    where: { emailAddress: addr },
    select: { displayName: true },
  });
  return firstNameOf(mailbox?.displayName, addr);
}

/**
 * The address a draft actually CCs, or null. NULL storage (pre-F4) means the
 * configured default; the mailbox owner is never CC'd, whichever was chosen.
 */
export function resolveDraftCc(stored: string | null | undefined, ownerEmail: string): string | null {
  const cc = (stored ?? config.draftCcEmail).trim();
  if (!cc) return null;
  return cc.toLowerCase() === ownerEmail.trim().toLowerCase() ? null : cc;
}
