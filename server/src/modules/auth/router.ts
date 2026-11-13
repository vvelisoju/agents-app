import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { hashPassword, verifyPassword, newToken } from '../../middleware/auth';

const router = Router();

router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'email already registered' });
  const org = await prisma.org.create({ data: { name: String(email).split('@')[0] + "'s workspace" } });
  await prisma.subscription.create({ data: { orgId: org.id } });
  const user = await prisma.user.create({
    data: { orgId: org.id, email, passwordHash: await hashPassword(password), token: newToken() },
  });
  res.json({ token: user.token, email: user.email });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  res.json({ token: user.token, email: user.email });
}));

export default router;
