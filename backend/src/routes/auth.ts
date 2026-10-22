import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db/client';
import { issueToken } from '../services/auth.service';
import { requireAuth } from '../middleware/requireAuth';
import { createError } from '../middleware/error';
import { config } from '../config';
import { checkLogin, isAdminEmail } from '../lib/accessPolicy';

const router = Router();

const googleSchema = z.object({
  idToken: z.string().min(1),
});

const oauthClient = new OAuth2Client(config.gmail.clientId);

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  role?: string;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role ?? 'recruiter',
    createdAt: user.createdAt,
  };
}

// Password-based signup + login were removed in Phase AX. The UI only ever
// used /api/auth/google; the dormant /signup endpoint accepted ANY email
// (no @archive.com restriction), so anyone on the internet could create a
// JWT with full access to all tenant data — single-tenant isolation was
// only enforced by the OAuth path.

// POST /api/auth/google
router.post(
  '/google',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = googleSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(createError(parsed.error.errors[0]?.message ?? 'Invalid input', 400));
      }
      const { idToken } = parsed.data;

      if (!config.gmail.clientId) {
        return next(createError('Google sign-in is not configured', 500));
      }

      let payload;
      try {
        const ticket = await oauthClient.verifyIdToken({
          idToken,
          audience: config.gmail.clientId,
        });
        payload = ticket.getPayload();
      } catch {
        return next(createError('Invalid Google ID token', 401));
      }

      if (!payload?.email || !payload.email_verified || !payload.sub) {
        return next(createError('Google account email is not verified', 401));
      }

      const email = payload.email.toLowerCase();
      const decision = checkLogin(email, payload.hd);
      if (!decision.allowed) {
        return next(
          createError(
            decision.reason === 'domain'
              ? 'Access restricted to @archive.com Google Workspace accounts'
              : 'This account is not authorized to use the recruiting app',
            403
          )
        );
      }
      const googleId = payload.sub;
      const name = payload.name ?? null;
      const avatarUrl = payload.picture ?? null;

      // ADMIN_EMAILS (env, no default) promotes listed users to admin on
      // sign-in. It never demotes: removing someone from the list leaves
      // their DB role alone, so revoke admin in the DB as well.
      const isConfiguredAdmin = isAdminEmail(email);

      const existing = await prisma.user.findUnique({ where: { email } });
      let user;
      if (existing) {
        user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            googleId: existing.googleId ?? googleId,
            avatarUrl: existing.avatarUrl ?? avatarUrl,
            name: existing.name ?? name,
            ...(isConfiguredAdmin && existing.role !== 'admin'
              ? { role: 'admin' }
              : {}),
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            googleId,
            avatarUrl,
            name,
            ...(isConfiguredAdmin ? { role: 'admin' } : {}),
          },
        });
      }

      const token = issueToken(user.id);
      res.json({
        success: true,
        data: { token, user: publicUser(user) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/auth/me (protected)
router.get(
  '/me',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.userId;
      if (!userId) {
        return next(createError('Unauthenticated', 401));
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return next(createError('User not found', 404));
      }
      res.json({ success: true, data: { user: publicUser(user) } });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
