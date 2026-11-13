// Billing (B10). Plans + subscribe. In dev (no RAZORPAY_* keys) /subscribe applies
// the plan directly; in production the Razorpay checkout → webhook calls the same
// upgrade after a verified payment. See docs/BACKLOG.md B10 for the webhook wiring.
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { PLANS, getPlan } from '../../lib/plans';

const router = Router();
const u = (req: any) => req.user;
const razorpayConfigured = () => !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

router.get('/plans', (_req, res) => res.json(PLANS));

router.get('/subscription', asyncHandler(async (req, res) => {
  const sub = await prisma.subscription.findUnique({ where: { orgId: u(req).orgId } });
  res.json({ ...sub, razorpayConfigured: razorpayConfigured() });
}));

router.post('/subscribe', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can change the plan', code: 'forbidden' });
  const plan = getPlan(String(req.body?.planId));
  if (!plan) return res.status(400).json({ error: 'unknown plan' });
  // TODO(B10): when RAZORPAY_* keys are set, create an order here and apply the
  // plan only from the verified webhook. Dev applies immediately.
  const sub = await prisma.subscription.update({
    where: { orgId: u(req).orgId },
    data: { plan: plan.id, maxAgents: plan.maxAgents, status: 'active' },
  });
  res.json(sub);
}));

export default router;
