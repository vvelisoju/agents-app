// FND-20 / QA-10 — Razorpay webhook makes billing server-authoritative.
import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import request from 'supertest';
import { buildApp } from '../src/app';
import prisma from '../src/lib/prisma';
import { verifyWebhookSignature } from '../src/lib/razorpay';
import { createOrg } from './helpers/factories';

const SECRET = 'test-webhook-secret';
beforeAll(() => { process.env.RAZORPAY_WEBHOOK_SECRET = SECRET; });

const app = buildApp();
const sign = (body: string) => crypto.createHmac('sha256', SECRET).update(body).digest('hex');

describe('Razorpay webhook', () => {
  it('verifyWebhookSignature accepts a correct HMAC and rejects others', () => {
    const body = '{"event":"order.paid"}';
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
    expect(verifyWebhookSignature(body, 'deadbeef')).toBe(false);
  });

  it('rejects a request with a bad signature', async () => {
    const r = await request(app)
      .post('/api/webhooks/razorpay')
      .set('x-razorpay-signature', 'bad')
      .set('content-type', 'application/json')
      .send('{"event":"order.paid"}');
    expect(r.status).toBe(400);
  });

  it('applies the plan from order notes on a signed order.paid event', async () => {
    const org = await createOrg();
    await prisma.subscription.create({ data: { orgId: org.id } }); // default free / maxAgents 10
    const payload = JSON.stringify({
      event: 'order.paid',
      payload: { order: { entity: { notes: { orgId: org.id, planId: 'growth' } } } },
    });
    const r = await request(app)
      .post('/api/webhooks/razorpay')
      .set('x-razorpay-signature', sign(payload))
      .set('content-type', 'application/json')
      .send(payload);
    expect(r.status).toBe(200);
    const sub = await prisma.subscription.findUnique({ where: { orgId: org.id } });
    expect(sub?.plan).toBe('growth');
    expect(sub?.maxAgents).toBe(50);
  });
});
