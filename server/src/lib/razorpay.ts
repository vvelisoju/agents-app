// Razorpay helper (raw API — no SDK). Keys come from RAZORPAY_* env. For a real
// upgrade: /checkout creates an order → client pays with Razorpay Checkout →
// /verify checks the payment signature (HMAC) and applies the plan.
import crypto from 'crypto';

const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';
export const configured = () => !!(keyId() && keySecret());

export async function createOrder(amountPaise: number, receipt: string, notes?: Record<string, string>) {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, payment_capture: 1, ...(notes ? { notes } : {}) }),
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(j?.error?.description || 'razorpay order creation failed');
  return j; // { id, amount, currency, ... }
}

// Verify the checkout callback: HMAC-SHA256(orderId|paymentId, keySecret) === signature.
export function verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto.createHmac('sha256', keySecret()).update(`${orderId}|${paymentId}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); } catch { return false; }
}

// Verify a Razorpay webhook (raw body + X-Razorpay-Signature header).
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature))); } catch { return false; }
}
