import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validate } from '../../middleware/validate';
import { credentials, forgotSchema, resetSchema } from '../../lib/schemas';
import { setOtp, verifyOtp, genOtp } from '../../lib/otpStore';
import { hashPassword, verifyPassword, newToken } from '../../middleware/auth';

const router = Router();

router.post('/signup', validate(credentials), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'email already registered' });
  const org = await prisma.org.create({ data: { name: String(email).split('@')[0] + "'s workspace" } });
  await prisma.subscription.create({ data: { orgId: org.id } });
  const user = await prisma.user.create({
    data: { orgId: org.id, email, passwordHash: await hashPassword(password), token: newToken() },
  });
  res.json({ token: user.token, email: user.email });
}));

router.post('/login', validate(credentials), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  res.json({ token: user.token, email: user.email });
}));

// Forgot password: generate a one-time code. Real delivery (SMS/WhatsApp/email) is
// B12.6; until then dev returns the code so the flow is testable. Response is
// generic (doesn't reveal whether the email exists) to avoid account enumeration.
router.post('/forgot', validate(forgotSchema), asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const otp = genOtp();
    setOtp(email, otp);
    console.log(`[password-reset] code for ${email}: ${otp}`);
    const devExpose = process.env.NODE_ENV !== 'production';
    return res.json({ ok: true, ...(devExpose ? { devOtp: otp } : {}) });
  }
  res.json({ ok: true });
}));

// Reset password: requires the valid, unexpired one-time code (server-verified).
router.post('/reset', validate(resetSchema), asyncHandler(async (req, res) => {
  const { email, otp, password } = req.body;
  if (!verifyOtp(email, otp)) return res.status(400).json({ error: 'invalid or expired code', code: 'invalid_otp' });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'account not found' });
  const token = newToken();
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password), token } });
  res.json({ token, email: user.email });
}));

export default router;
