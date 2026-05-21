import { Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client';

// Layered on top of requireAuth: assumes `req.userId` has already been set.
// Looks up the user's role and returns 403 unless it's `admin`. Used to
// protect bulk / destructive endpoints (mailbox resync, refresh-all-profiles,
// regenerate-pending, backfill-roles, DELETE mailbox).
//
// The role column was added in migration 6_user_role; new users default to
// `recruiter`. Promotion is manual today (one-shot data migration for the
// founding operator), so this guard fails closed for everyone else.
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthenticated' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }
    if (user.role !== 'admin') {
      res
        .status(403)
        .json({ success: false, error: 'Admin role required for this action' });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
