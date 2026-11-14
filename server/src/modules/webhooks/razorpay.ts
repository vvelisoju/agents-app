// FND-20 — Razorpay webhook: makes billing server-authoritative. Even if the browser
// never calls /verify after a successful payment, this applies the plan. Must receive
// the RAW body (signature is HMAC of the exact bytes), so it is mounted with
// express.raw BEFORE the global express.json. (Phase-5 EWS-16/17 relocates this into a
// single raw-body webhooks router; this is the interim.)
import type { Request, Response } from 'express';
import { verifyWebhookSignature } from '../../lib/razorpay';
import { applyPlan } from '../../lib/subscription';

export async function razorpayWebhook(req: Request, res: Response) {
  const signature = String(req.headers['x-razorpay-signature'] || '');
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!verifyWebhookSignature(raw, signature)) {
    return res.status(400).json({ error: 'invalid signature' });
  }
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return res.status(400).json({ error: 'bad payload' }); }

  // On a paid order, read the orgId/planId we stamped into the order notes at checkout.
  if (evt?.event === 'order.paid') {
    const notes = evt?.payload?.order?.entity?.notes || {};
    if (notes.orgId && notes.planId) {
      await applyPlan(String(notes.orgId), String(notes.planId));
    }
  }
  res.json({ ok: true });
}
