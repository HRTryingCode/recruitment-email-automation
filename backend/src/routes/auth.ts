import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db/client';
import {
  hashPassword,
  issueToken,
  verifyPassword,
} from '../services/auth.service';
import { requireAuth } from '../middleware/requireAuth';
import { createError } from '../middleware/error';
import { config } from '../config';

const router = Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const googleSchema = z.object({
  idToken: z.string().min(1),
});

const oauthClient = new OAuth2Client(config.gmail.clientId);

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    createdAt: user.createdAt,
  };
}

// POST /api/auth/signup
router.post(
  '/signup',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = signupSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(createError(parsed.error.errors[0]?.message ?? 'Invalid input', 400));
      }
      const { email, password, name } = parsed.data;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return next(createError('Email already registered', 409));
      }

      const passwordHash = await hashPassword(password);
      const user = await prisma.user.create({
        data: { email, passwordHash, name: name ?? null },
      });

      const token = issueToken(user.id);
      res.status(201).json({
        success: true,
        data: { token, user: publicUser(user) },
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/auth/login
router.post(
  '/login',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(createError(parsed.error.errors[0]?.message ?? 'Invalid input', 400));
      }
      const { email, password } = parsed.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.passwordHash) {
        return next(createError('Invalid email or password', 401));
      }

      const ok = await verifyPassword(password, user.passwordHash);
      if (!ok) {
        return next(createError('Invalid email or password', 401));
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
      const googleId = payload.sub;
      const name = payload.name ?? null;
      const avatarUrl = payload.picture ?? null;

      const existing = await prisma.user.findUnique({ where: { email } });
      let user;
      if (existing) {
        user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            googleId: existing.googleId ?? googleId,
            avatarUrl: existing.avatarUrl ?? avatarUrl,
            name: existing.name ?? name,
          },
        });
      } else {
        user = await prisma.user.create({
          data: {
            email,
            googleId,
            avatarUrl,
            name,
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
