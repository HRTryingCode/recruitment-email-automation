// Who has a draft open, and the send lock that follows from it (U0).
//
// The UI heartbeats POST /api/drafts/:id/presence every ~15s while a draft is
// open and DELETEs on close. No websockets: readers poll. A heartbeat older
// than PRESENCE_STALE_MS counts as gone, so a closed tab stops locking within
// 45s even if its DELETE never arrived.
import { prisma } from '../db/client';

export const PRESENCE_STALE_MS = 45_000;
/** Rows this old are deleted on the next heartbeat (housekeeping only). */
const PRESENCE_REAP_MS = 60 * 60_000;

export const PRESENCE_MODES = ['viewing', 'editing'] as const;
export type PresenceMode = (typeof PRESENCE_MODES)[number];

export interface PresenceEntry {
  userId: string;
  name: string;
  mode: PresenceMode;
}

export async function heartbeatPresence(
  draftId: string,
  userId: string,
  mode: PresenceMode,
  now: Date = new Date()
): Promise<void> {
  await prisma.draftPresence.upsert({
    where: { draftId_userId: { draftId, userId } },
    create: { draftId, userId, mode, heartbeatAt: now },
    update: { mode, heartbeatAt: now },
  });
  await prisma.draftPresence.deleteMany({
    where: { heartbeatAt: { lt: new Date(now.getTime() - PRESENCE_REAP_MS) } },
  });
}

export async function clearPresence(draftId: string, userId: string): Promise<void> {
  await prisma.draftPresence.deleteMany({ where: { draftId, userId } });
}

/** Fresh presence per draft id, leaving out `excludeUserId` (the caller). */
export async function listPresence(
  draftIds: string[],
  excludeUserId: string | undefined,
  now: Date = new Date()
): Promise<Map<string, PresenceEntry[]>> {
  const out = new Map<string, PresenceEntry[]>();
  if (draftIds.length === 0) return out;
  const rows = await prisma.draftPresence.findMany({
    where: {
      draftId: { in: draftIds },
      heartbeatAt: { gte: new Date(now.getTime() - PRESENCE_STALE_MS) },
      ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { heartbeatAt: 'desc' },
  });
  for (const r of rows) {
    const list = out.get(r.draftId) ?? [];
    list.push({ userId: r.userId, name: r.user.name || r.user.email, mode: r.mode as PresenceMode });
    out.set(r.draftId, list);
  }
  return out;
}

/** The other user currently editing this draft, if any — they hold the send lock. */
export async function findLockHolder(
  draftId: string,
  userId: string,
  now: Date = new Date()
): Promise<{ userId: string; name: string } | null> {
  const entries = (await listPresence([draftId], userId, now)).get(draftId) ?? [];
  const editor = entries.find((e) => e.mode === 'editing');
  return editor ? { userId: editor.userId, name: editor.name } : null;
}
