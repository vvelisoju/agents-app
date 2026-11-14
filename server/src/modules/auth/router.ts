// Phone-keyed accounts with WhatsApp OTP (B2.1). Signup is two steps: /signup/start
// sends a code over WhatsApp, /signup/verify checks it and creates the account.
// Login is phone + password. Forgot/reset is the same OTP flow, purpose-scoped.
// In dev the OTP is echoed as `devOtp` so the flow is testable without a live phone.
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { signupStartSchema, signupVerifySchema, loginSchema, forgotSchema, resetSchema } from '../../lib/schemas';
import { hashPassword, verifyPassword, newToken, authMiddleware } from '../../middleware/auth';
import { normalizePhone } from '../../lib/phone';
import { requestOtp, verifyOtp, consumeVerification } from '../../lib/otp';

const router = Router();
const badPhone = (res: any) => res.status(400).json({ error: 'enter a valid mobile number', code: 'invalid_phone' });

// Step 1: send a signup code. Generic response — doesn't reveal whether the phone
// is already registered (that surfaces at /verify, after the code is proven).
router.post('/signup/start', validate(signupStartSchema), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return badPhone(res);
  const r = await requestOtp(phone, 'signup');
  if (!r.sent && r.reason === 'rate_limited') return res.status(429).json({ error: 'too many codes, try again later', code: 'rate_limited' });
  res.json({ ok: true, ...(r.devOtp ? { devOtp: r.devOtp } : {}) });
}));

// Step 2: verify the code and create the account.
router.post('/signup/verify', validate(signupVerifySchema), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone) return badPhone(res);
  if (!(await verifyOtp(phone, req.body.otp, 'signup'))) return res.status(400).json({ error: 'invalid or expired code', code: 'invalid_otp' });
  if (await prisma.user.findUnique({ where: { phone } })) return res.status(409).json({ error: 'this number is already registered', code: 'already_registered' });
  const org = await prisma.org.create({ data: { name: phone + "'s workspace" } });
  await prisma.subscription.create({ data: { orgId: org.id } });
  const user = await prisma.user.create({
    data: { orgId: org.id, phone, passwordHash: await hashPassword(req.body.password), token: newToken() },
  });
  await consumeVerification(phone, 'signup');
  res.json({ token: user.token, phone: user.phone });
}));

router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const user = phone ? await prisma.user.findUnique({ where: { phone } }) : null;
  if (!user || !(await verifyPassword(req.body.password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid mobile number or password' });
  }
  res.json({ token: user.token, phone: user.phone });
}));

// Forgot password: send a reset code. Generic response (doesn't reveal whether the
// number exists) to avoid account enumeration.
router.post('/forgot', validate(forgotSchema), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (phone) {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user) {
      const r = await requestOtp(phone, 'password_reset');
      return res.json({ ok: true, ...(r.devOtp ? { devOtp: r.devOtp } : {}) });
    }
  }
  res.json({ ok: true });
}));

// Reset: requires the valid, unexpired code. Rotates the bearer token.
router.post('/reset', validate(resetSchema), asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  if (!phone || !(await verifyOtp(phone, req.body.otp, 'password_reset'))) {
    return res.status(400).json({ error: 'invalid or expired code', code: 'invalid_otp' });
  }
  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) return res.status(404).json({ error: 'account not found' });
  const token = newToken();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(req.body.password), token } });
  await consumeVerification(phone, 'password_reset');
  res.json({ token, phone: user.phone });
}));

// SEC-6: logout. Rotates the caller's bearer token so the presented one stops
// working immediately — the client simply drops its copy. Rotating (rather than
// nulling) keeps the column populated and works the same under the future hashed
// token scheme. Idempotent and auth-gated; never reveals anything on a bad token.
router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const user = (req as any).user;
  await prisma.user.update({ where: { id: user.id }, data: { token: newToken() } });
  res.json({ ok: true });
}));

export default router;
