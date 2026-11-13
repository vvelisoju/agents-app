// =============================================================
// src/auth.ts — minimal email/password auth with a bearer token.
// Skeleton-grade (see docs/BACKLOG.md for hardening: JWT, refresh,
// rate limiting). Tenant isolation is enforced by org_id checks.
// =============================================================
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getUserByToken } from './db';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(':');
    const test = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

export const newToken = () => crypto.randomBytes(24).toString('hex');

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = (req.headers['authorization'] as string) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? getUserByToken(token) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  (req as any).user = user;
  next();
}
