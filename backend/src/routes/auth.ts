import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db/client';
import {
  hashPassword,
  issueToken,
  verifyPassword,
} from '../services/auth.service';
import { requireAuth } from '../middleware/requireAuth';
import { createError } from '../middleware/error';

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

function publicUser(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
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
      if (!user) {
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
