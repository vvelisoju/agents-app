// Auth: bcrypt password hashing + a bearer token per user. Tenant isolation is
// enforced by org_id checks (requireAgent). Session/passport + phone OTP is the
// B2.1 upgrade; this token scheme is a clean, working baseline.
import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';

export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
export const newToken = () => crypto.randomBytes(24).toString('hex');

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = (req.headers['authorization'] as string) || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const user = token ? await prisma.user.findUnique({ where: { token } }) : null;
  if (!user) return res.status(401).json({ error: 'unauthorized', code: 'unauthorized' });
  (req as any).user = user;
  next();
}

// Loads an agent by :id, checks it belongs to the caller's org, attaches req.agent.
export async function requireAgent(req: Request, res: Response, next: NextFunction) {
  const agent = await prisma.agent.findUnique({ where: { id: String(req.params.id) } });
  if (!agent || agent.orgId !== (req as any).user.orgId) {
    return res.status(404).json({ error: 'agent not found' });
  }
  (req as any).agent = agent;
  next();
}
