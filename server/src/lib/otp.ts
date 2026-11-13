// WhatsApp OTP: request + verify, cloned from ClassPe's otp.ts. 6-digit CSPRNG
// code, bcrypt-hashed, stored BEFORE the send, 10-min TTL, 5 attempts, 3/hour.
// Purpose-scoped ('signup' vs 'password_reset') so a signup code can't reset a
// password. In dev (NODE_ENV!=='production') the code is echoed as `devOtp` so
// the flow is testable without a live phone.
import { randomInt } from 'crypto';
import prisma from './prisma';
import { hashPassword, verifyPassword } from '../middleware/auth';
import { sendOtp, isSendConfigured } from './whatsappCloud';

export type OtpPurpose = 'signup' | 'password_reset';
const TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 3;

const genCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
const devEcho = () => process.env.NODE_ENV !== 'production';

export async function requestOtp(phone: string, purpose: OtpPurpose): Promise<{ sent: boolean; reason?: string; devOtp?: string }> {
  const hourAgo = new Date(Date.now() - 3_600_000);
  const recent = await prisma.phoneVerification.count({ where: { phone, createdAt: { gte: hourAgo } } });
  if (recent >= MAX_PER_HOUR) return { sent: false, reason: 'rate_limited' };

  const code = genCode();
  const codeHash = await hashPassword(code);
  // Row BEFORE the send: a send whose response is lost still leaves a verifiable code.
  await prisma.phoneVerification.create({ data: { phone, codeHash, purpose, expiresAt: new Date(Date.now() + TTL_MIN * 60_000) } });

  const out = isSendConfigured() ? await sendOtp(phone, code) : { ok: false, error: 'not_configured' };
  // Ops log so a failed/absent real send is visible (never logs the code; phone masked).
  if (isSendConfigured()) {
    const masked = '****' + phone.slice(-4);
    console.log(`[otp] WhatsApp ${purpose} send to ${masked}: ${out.ok ? 'OK' : 'FAILED — ' + out.error}`);
  }
  const dev = devEcho() ? { devOtp: code } : {};
  return out.ok ? { sent: true, ...dev } : { sent: false, reason: out.error || 'send_failed', ...dev };
}

export async function verifyOtp(phone: string, code: string, purpose: OtpPurpose): Promise<boolean> {
  const row = await prisma.phoneVerification.findFirst({ where: { phone, purpose, consumedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row) return false;
  if (row.verifiedAt) return true; // already verified; re-verifying isn't an error
  if (row.expiresAt.getTime() < Date.now()) return false;
  if (row.attempts >= MAX_ATTEMPTS) return false;

  await prisma.phoneVerification.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
  const ok = await verifyPassword(code.trim(), row.codeHash);
  if (!ok) return false;
  await prisma.phoneVerification.update({ where: { id: row.id }, data: { verifiedAt: new Date() } });
  return true;
}

// Mark the verified code consumed so one code can't be reused.
export async function consumeVerification(phone: string, purpose: OtpPurpose): Promise<boolean> {
  const row = await prisma.phoneVerification.findFirst({
    where: { phone, purpose, consumedAt: null, verifiedAt: { not: null } },
    orderBy: { verifiedAt: 'desc' },
  });
  if (!row) return false;
  await prisma.phoneVerification.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return true;
}
