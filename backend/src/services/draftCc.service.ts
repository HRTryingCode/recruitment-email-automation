// Per-draft CC (F4). EmailDraft.ccEmail stores the CC a draft goes out with:
// NULL = a pre-F4 draft, fall back to the configured default (DRAFT_CC_EMAIL);
// NO_CC ('') = the recruiter chose "No CC"; otherwise the address.
import { prisma } from '../db/client';
import { config } from '../config';

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
 * DRAFT_CC_OPTIONS: comma-separated addresses a draft may CC — the
 * recruitment team, not every admin. Unset/empty falls back to the configured
 * default CC alone. Read per call so a Vercel env change needs no deploy.
 */
export function draftCcOptionEmails(): string[] {
  const raw = (process.env.DRAFT_CC_OPTIONS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const list = raw.length ? raw : [config.draftCcEmail.trim().toLowerCase()].filter(Boolean);
  return [...new Set(list)];
}

/**
 * Everyone a draft may CC (DRAFT_CC_OPTIONS), sorted by name.
 * `excludeEmail` (the draft's mailbox owner) is left out — a mailbox never
 * CCs itself.
 */
export async function listCcOptions(opts: { excludeEmail?: string } = {}): Promise<CcOption[]> {
  const exclude = opts.excludeEmail?.trim().toLowerCase();
  const emails = draftCcOptionEmails().filter((e) => e !== exclude);
  if (!emails.length) return [];

  const [users, mailboxes] = await Promise.all([
    prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true, name: true } }),
    prisma.mailbox.findMany({
      where: { emailAddress: { in: emails } },
      select: { emailAddress: true, displayName: true },
    }),
  ]);
  const userName = new Map(users.map((u) => [u.email.toLowerCase(), u.name?.trim() || null]));
  const displayName = new Map(mailboxes.map((m) => [m.emailAddress.toLowerCase(), m.displayName?.trim() || null]));

  return emails
    .map((email) => {
      const known = userName.get(email) || displayName.get(email);
      return { email, name: known || localPart(email), firstName: firstNameOf(known, email) };
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
