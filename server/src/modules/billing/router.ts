// Billing (B10). Plans + Razorpay checkout/verify. Flow: /checkout creates a
// Razorpay order → client pays with Razorpay Checkout → /verify checks the
// payment signature and applies the plan. /subscribe is a dev/admin direct-apply
// (disabled in production once Razorpay is configured).
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { PLANS, getPlan } from '../../lib/plans';
import { configured, createOrder, verifyPaymentSignature } from '../../lib/razorpay';
import { applyPlan } from '../../lib/subscription';

const router = Router();
const u = (req: any) => req.user;

router.get('/plans', (_req, res) => res.json(PLANS));

router.get('/subscription', asyncHandler(async (req, res) => {
  const sub = await prisma.subscription.findUnique({ where: { orgId: u(req).orgId } });
  res.json({ ...sub, razorpayConfigured: configured() });
}));

// Create a Razorpay order for a paid plan. orgId + planId go in the order notes so the
// webhook (FND-20) can apply the plan server-authoritatively.
router.post('/checkout', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can upgrade', code: 'forbidden' });
  if (!configured()) return res.status(400).json({ error: 'billing is not configured', code: 'billing_unconfigured' });
  const plan = getPlan(String(req.body?.planId));
  if (!plan || plan.priceInr <= 0) return res.status(400).json({ error: 'pick a paid plan' });
  const receipt = `o_${u(req).orgId.slice(0, 8)}_${plan.id}_${Date.now()}`.slice(0, 40);
  const order = await createOrder(plan.priceInr * 100, receipt, { orgId: u(req).orgId, planId: plan.id });
  res.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId: process.env.RAZORPAY_KEY_ID, planId: plan.id });
}));

// Apply the plan after a verified payment.
router.post('/verify', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'forbidden', code: 'forbidden' });
  const { orderId, paymentId, signature, planId } = req.body || {};
  if (!verifyPaymentSignature(String(orderId), String(paymentId), String(signature))) {
    return res.status(400).json({ error: 'payment verification failed', code: 'invalid_signature' });
  }
  const sub = await applyPlan(u(req).orgId, String(planId));
  if (!sub) return res.status(400).json({ error: 'unknown plan' });
  res.json(sub);
}));

// Dev/admin direct apply (no payment) — blocked in production when Razorpay is live.
router.post('/subscribe', asyncHandler(async (req, res) => {
  if (u(req).role !== 'owner') return res.status(403).json({ error: 'only the owner can change the plan', code: 'forbidden' });
  // FND-21: never allow a free plan upgrade in production — even if Razorpay is not
  // configured (previously this gap let a misconfigured prod self-upgrade to any plan).
  if (process.env.NODE_ENV === 'production') {
    return res.status(400).json({ error: 'use /checkout to pay', code: 'payment_required' });
  }
  const sub = await applyPlan(u(req).orgId, String(req.body?.planId));
  if (!sub) return res.status(400).json({ error: 'unknown plan' });
  res.json(sub);
}));

export default router;
