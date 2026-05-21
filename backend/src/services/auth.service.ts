import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// OWASP 2024 password storage cheatsheet recommends ≥12 for bcrypt.
// Existing hashes encode their own cost prefix so verifyPassword still works
// against rows hashed with the old factor.
const SALT_ROUNDS = 12;
const TOKEN_EXPIRES_IN = '7d';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function issueToken(userId: string): string {
  return jwt.sign({ userId }, config.jwtSecret, {
    expiresIn: TOKEN_EXPIRES_IN,
  });
}

export function verifyToken(token: string): { userId: string } | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as
      | { userId?: unknown }
      | string;
    if (typeof decoded === 'object' && decoded && typeof decoded.userId === 'string') {
      return { userId: decoded.userId };
    }
    return null;
  } catch {
    return null;
  }
}
