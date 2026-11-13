import { z } from 'zod';

// Shared request schemas (hardening / B13.3).
export const credentials = z.object({
  email: z.string().email('must be a valid email').max(200),
  password: z.string().min(6, 'at least 6 characters').max(200),
});

export const forgotSchema = z.object({
  email: z.string().email('must be a valid email').max(200),
});

export const resetSchema = z.object({
  email: z.string().email('must be a valid email').max(200),
  otp: z.string().min(4, 'enter the code').max(10),
  password: z.string().min(6, 'at least 6 characters').max(200),
});

export const createAgentSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  channelType: z.enum(['whatsapp-web', 'website', 'telegram']).optional(),
});

export const sourceSchema = z.object({
  type: z.enum(['fact', 'link', 'faq']),
  data: z.record(z.string(), z.any()),
});

export const addMemberSchema = z.object({
  email: z.string().email('must be a valid email').max(200),
  password: z.string().min(6, 'at least 6 characters').max(200),
  role: z.enum(['owner', 'member']).optional(),
});
