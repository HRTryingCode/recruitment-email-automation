import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/auth.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    res
      .status(401)
      .json({ success: false, error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice(7).trim();
  if (!token) {
    res
      .status(401)
      .json({ success: false, error: 'Missing bearer token' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
    return;
  }

  req.userId = payload.userId;
  next();
}
