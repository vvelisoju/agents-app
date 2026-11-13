// Team members (B2.5). Owner can add/remove members in the org. (Email-based
// invites with delivery are B12.6; this is the working create-member baseline.)
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { hashPassword, newToken } from '../../middleware/auth';

const router = Router();
const u = (req: any) => req.user;

router.get('/', asyncHandler(async (req, res) => {
  const members = await prisma.user.findMany({
    where: { orgId: u(req).orgId },
    select: { id: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members);
}));

router.post('/', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can add members', code: 'forbidden' });
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (await prisma.user.findUnique({ where: { email } })) return res.status(409).json({ error: 'email already registered' });
  const m = await prisma.user.create({
    data: { orgId: u(req).orgId, email, passwordHash: await hashPassword(password), token: newToken(), role: role === 'owner' ? 'owner' : 'member' },
  });
  res.json({ id: m.id, email: m.email, role: m.role });
}));

router.delete('/:userId', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can remove members', code: 'forbidden' });
  const target = await prisma.user.findUnique({ where: { id: String(req.params.userId) } });
  if (!target || target.orgId !== u(req).orgId) return res.status(404).json({ error: 'member not found' });
  if (target.id === u(req).id) return res.status(400).json({ error: 'you cannot remove yourself' });
  const owners = await prisma.user.count({ where: { orgId: u(req).orgId, role: 'owner' } });
  if (target.role === 'owner' && owners <= 1) return res.status(400).json({ error: 'cannot remove the last owner' });
  await prisma.user.delete({ where: { id: target.id } });
  res.json({ ok: true });
}));

export default router;
