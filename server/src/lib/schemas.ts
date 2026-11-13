import { z } from 'zod';

// Shared request schemas (hardening / B13.3). Accounts are keyed by phone; the
// router calls normalizePhone() for the real validation, so these stay permissive
// (digits, spaces, +, dashes allowed in; 10–15 chars).
const phone = z.string().trim().min(10, 'enter your mobile number').max(15);
const otp = z.string().trim().min(4, 'enter the code').max(10);
const password = z.string().min(6, 'at least 6 characters').max(200);

export const signupStartSchema = z.object({ phone });
export const signupVerifySchema = z.object({ phone, otp, password });
export const loginSchema = z.object({ phone, password: z.string().min(1, 'enter your password').max(200) });
export const forgotSchema = z.object({ phone });
export const resetSchema = z.object({ phone, otp, password });

export const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  channelType: z.enum(['whatsapp-web', 'website', 'telegram']).optional(),
});

export const sourceSchema = z.object({
  type: z.enum(['fact', 'link', 'faq']),
  data: z.record(z.string(), z.any()),
});

export const addMemberSchema = z.object({ phone, password, role: z.enum(['owner', 'member']).optional() });
