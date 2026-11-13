// In-memory one-time-code store for password reset. Single-instance only — for
// production move to Redis/DB and deliver the code via SMS/WhatsApp/email (B12.6).
const store = new Map<string, { otp: string; expires: number }>();

export const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));

export function setOtp(email: string, otp: string, ttlMs = 10 * 60 * 1000) {
  store.set(email.toLowerCase(), { otp, expires: Date.now() + ttlMs });
}

export function verifyOtp(email: string, otp: string): boolean {
  const e = store.get(email.toLowerCase());
  if (!e || e.expires < Date.now()) return false;
  if (e.otp !== otp) return false;
  store.delete(email.toLowerCase()); // single use
  return true;
}
