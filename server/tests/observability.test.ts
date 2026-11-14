// OBS-11/13/15 — execution viewer endpoints + readiness probe.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import prisma from '../src/lib/prisma';
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('observability endpoints', () => {
  it('/api/health/ready returns 200 when the DB is reachable', async () => {
    const r = await request(app).get('/api/health/ready');
    expect(r.status).toBe(200);
    expect(r.body.ready).toBe(true);
  });

  it('owner reads executions + metrics; member is denied (owner-only)', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const member = await createUser(org.id, 'member');
    const agent = await createAgent(org.id);
    await prisma.usageEvent.create({
      data: {
        orgId: org.id, agentId: agent.id, type: 'reply', executionId: 'e1', outcome: 'sent',
        model: 'm', inputTokens: 10, outputTokens: 5, costMicros: 20, latencyMs: 100,
      },
    });

    const ex = await request(app).get('/api/analytics/executions').set(auth(owner.token));
    expect(ex.status).toBe(200);
    expect(ex.body.executions.length).toBeGreaterThan(0);
    expect(ex.body.executions[0].outcome).toBe('sent');

    const mx = await request(app).get('/api/analytics/metrics').set(auth(owner.token));
    expect(mx.status).toBe(200);
    expect(mx.body.total).toBeGreaterThan(0);
    expect(mx.body.successRate).toBeGreaterThan(0);

    const denied = await request(app).get('/api/analytics/executions').set(auth(member.token));
    expect(denied.status).toBe(403);
  });

  // MGW-15 — usage/cap meter, readable by any member.
  it('/api/analytics/usage reports used/cap/remaining for the day', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const member = await createUser(org.id, 'member');
    const agent = await createAgent(org.id);
    await prisma.usageEvent.createMany({
      data: [1, 2, 3].map((n) => ({ orgId: org.id, agentId: agent.id, type: 'reply', executionId: 'u' + n, outcome: 'sent' })),
    });
    const r = await request(app).get('/api/analytics/usage').set(auth(member.token)); // member allowed
    expect(r.status).toBe(200);
    expect(r.body.used).toBe(3);
    expect(r.body.cap).toBeGreaterThan(0);
    expect(r.body.remaining).toBe(r.body.cap - 3);
    expect(r.body.allowed).toBe(true);
    expect(typeof r.body.nearCap).toBe('boolean');
    expect(owner.token).toBeTruthy();
  });
});
