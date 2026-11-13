// Team members (B2.5). Owner can add/remove members in the org. Members are keyed
// by phone, same as account signup; the owner sets an initial password for them.
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { addMemberSchema } from '../../lib/schemas';
import { hashPassword, newToken } from '../../middleware/auth';
import { normalizePhone } from '../../lib/phone';

const router = Router();
const u = (req: any) => req.user;

router.get('/', asyncHandler(async (req, res) => {
  const members = await prisma.user.findMany({
    where: { orgId: u(req).orgId },
    select: { id: true, phone: true, role: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members);
}));

router.post('/', validate(addMemberSchema), asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can add members', code: 'forbidden' });
  const phone = normalizePhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: 'enter a valid mobile number', code: 'invalid_phone' });
  const { password, role } = req.body;
  if (await prisma.user.findUnique({ where: { phone } })) return res.status(409).json({ error: 'this number is already registered', code: 'already_registered' });
  const m = await prisma.user.create({
    data: { orgId: u(req).orgId, phone, passwordHash: await hashPassword(password), token: newToken(), role: role === 'owner' ? 'owner' : 'member' },
  });
  res.json({ id: m.id, phone: m.phone, role: m.role });
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
