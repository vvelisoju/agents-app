import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';

const app = buildApp();
const email = () => `it${Date.now()}_${Math.random().toString(36).slice(2)}@d.com`;
async function signup() {
  const r = await request(app).post('/api/auth/signup').send({ email: email(), password: 'secret123' });
  return r.body.token as string;
}
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('API integration', () => {
  it('health is ok', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('rejects unauthenticated access to agents', async () => {
    const r = await request(app).get('/api/agents');
    expect(r.status).toBe(401);
  });

  it('signup → me → create agent → training CRUD → apply template', async () => {
    const t = await signup();
    const me = await request(app).get('/api/me').set(auth(t));
    expect(me.status).toBe(200);
    expect(me.body.orgId).toBeTruthy();

    const a = await request(app).post('/api/agents').set(auth(t)).send({ name: 'A', channelType: 'website' });
    expect(a.status).toBe(200);
    expect(a.body.channelType).toBe('website');

    await request(app).post(`/api/agents/${a.body.id}/training/sources`).set(auth(t)).send({ type: 'fact', data: { content: 'Open 9-5' } });
    const tr = await request(app).get(`/api/agents/${a.body.id}/training`).set(auth(t));
    expect(tr.body.sources.length).toBe(1);
    expect(tr.body.summary).toContain('1 fact');

    const tpls = await request(app).get('/api/templates').set(auth(t));
    expect(tpls.body.length).toBe(7);

    const ap = await request(app).post(`/api/agents/${a.body.id}/training/apply-template`).set(auth(t)).send({ templateId: 'gym' });
    expect(ap.status).toBe(200);
    expect(ap.body.instructions).toMatch(/gym|fitness/i);
  });

  it('enforces tenant isolation (another org gets 404)', async () => {
    const t1 = await signup();
    const t2 = await signup();
    const a = await request(app).post('/api/agents').set(auth(t1)).send({ name: 'Secret', channelType: 'website' });
    expect((await request(app).get(`/api/agents/${a.body.id}`).set(auth(t1))).status).toBe(200);
    expect((await request(app).get(`/api/agents/${a.body.id}`).set(auth(t2))).status).toBe(404);
    // and org 2 cannot change org 1's training
    const patch = await request(app).put(`/api/agents/${a.body.id}/training/profile`).set(auth(t2)).send({ instructions: 'hacked' });
    expect(patch.status).toBe(404);
  });

  it('enforces the plan agent limit (402)', async () => {
    const t = await signup();
    // default plan allows 10 agents
    for (let i = 0; i < 10; i++) {
      const r = await request(app).post('/api/agents').set(auth(t)).send({ name: 'A' + i, channelType: 'website' });
      expect(r.status).toBe(200);
    }
    const over = await request(app).post('/api/agents').set(auth(t)).send({ name: 'too many', channelType: 'website' });
    expect(over.status).toBe(402);
    expect(over.body.code).toBe('subscription_required');
  });

  it('leads list is org-scoped and returns an array', async () => {
    const t = await signup();
    const r = await request(app).get('/api/leads').set(auth(t));
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
  });

  it('team: owner adds a member in the same org; member cannot manage team', async () => {
    const t = await signup();
    const memberEmail = email();
    const add = await request(app).post('/api/team').set(auth(t)).send({ email: memberEmail, password: 'secret123' });
    expect(add.status).toBe(200);
    expect(add.body.role).toBe('member');
    const list = await request(app).get('/api/team').set(auth(t));
    expect(list.body.length).toBe(2); // owner + member

    const login = await request(app).post('/api/auth/login').send({ email: memberEmail, password: 'secret123' });
    const mt = login.body.token;
    const ownerOrg = (await request(app).get('/api/me').set(auth(t))).body.orgId;
    const memberOrg = (await request(app).get('/api/me').set(auth(mt))).body.orgId;
    expect(memberOrg).toBe(ownerOrg); // same workspace

    const memAdd = await request(app).post('/api/team').set(auth(mt)).send({ email: email(), password: 'secret123' });
    expect(memAdd.status).toBe(403); // only owner can add
  });

  it('org: get + rename', async () => {
    const t = await signup();
    const org = await request(app).get('/api/org').set(auth(t));
    expect(org.status).toBe(200);
    expect(org.body.plan).toBe('free');
    const r = await request(app).patch('/api/org').set(auth(t)).send({ name: 'Acme Co' });
    expect(r.body.name).toBe('Acme Co');
  });

  it('analytics returns org-scoped counts', async () => {
    const t = await signup();
    await request(app).post('/api/agents').set(auth(t)).send({ name: 'A', channelType: 'website' });
    const r = await request(app).get('/api/analytics').set(auth(t));
    expect(r.status).toBe(200);
    expect(r.body.agents).toBe(1);
    expect(typeof r.body.repliesTotal).toBe('number');
    expect(r.body.leadsByStatus).toBeDefined();
  });

  it('billing: plans list + owner subscribe raises the agent limit', async () => {
    const t = await signup();
    const plans = await request(app).get('/api/billing/plans').set(auth(t));
    expect(plans.body.length).toBeGreaterThanOrEqual(2);
    const sub = await request(app).post('/api/billing/subscribe').set(auth(t)).send({ planId: 'growth' });
    expect(sub.body.plan).toBe('growth');
    const org = await request(app).get('/api/org').set(auth(t));
    expect(org.body.maxAgents).toBe(50);
  });

  it('business hours: outside hours returns the away message once, then stays quiet', async () => {
    const t = await signup();
    const a = await request(app).post('/api/agents').set(auth(t)).send({ name: 'Hrs', channelType: 'website' });
    const h = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()), 10) % 24;
    // a 1-hour window 2 hours ahead → "now" is always outside it
    await request(app).patch(`/api/agents/${a.body.id}`).set(auth(t)).send({
      autoSend: true, awayMessage: 'We are closed now, back soon.', hoursStart: (h + 2) % 24, hoursEnd: (h + 3) % 24, timezone: 'Asia/Kolkata',
    });
    const cid = 'v' + Date.now();
    const r1 = await request(app).post(`/api/public/widget/${a.body.id}/message`).send({ contactId: cid, text: 'Hello?' });
    expect(r1.body.status).toBe('away');
    expect(r1.body.reply).toContain('closed');
    const r2 = await request(app).post(`/api/public/widget/${a.body.id}/message`).send({ contactId: cid, text: 'Still there?' });
    expect(r2.body.status).toBe('ignored'); // no spam
  });
});
