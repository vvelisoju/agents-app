// SCN-42 — HTTP coverage for the website-monitor Watch CRUD at /api/agents/:id/watches.
// Mirrors the service-level monitor.test.ts but drives the real Express router (auth,
// requireAgent tenant scoping, requirePermission('train_edit'), SSRF guard, Trigger wiring).
// Offline: literal IP URLs only (no DNS), owner token for the privileged writes.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { MONITOR_HANDLER } from '../src/workflow/handlers/scheduledMonitor';
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

const PUBLIC_URL = 'http://93.184.216.34/deals'; // literal public IP → no DNS, offline
const PRIVATE_URL = 'http://127.0.0.1/'; // loopback → SSRF guard must refuse

describe('Watch CRUD API (SCN-42)', () => {
  let orgId: string;
  let token: string;
  let agentId: string;

  beforeEach(async () => {
    const org = await createOrg();
    orgId = org.id;
    token = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId)).id;
  });

  it('POST creates a watch and pairs a scheduled-monitor cron Trigger', async () => {
    const r = await request(app)
      .post(`/api/agents/${agentId}/watches`)
      .set(auth(token))
      .send({ url: PUBLIC_URL, label: 'Deals', cadence: 'daily' });

    expect(r.status).toBe(200);
    expect(r.body.triggerId).toBeTruthy();
    expect(r.body.cronExpr).toBe('0 9 * * *'); // daily → 9am
    expect(r.body.url).toBe('http://93.184.216.34/deals');

    const t = await prisma.trigger.findUnique({ where: { id: r.body.triggerId } });
    expect(t).toBeTruthy();
    expect(t!.handlerName).toBe('scheduled-monitor');
    expect(t!.handlerName).toBe(MONITOR_HANDLER);
    expect(t!.kind).toBe('cron');
    expect(t!.enabled).toBe(true);
    expect(JSON.parse(t!.filterJson).watchId).toBe(r.body.id);
  });

  it('POST with no url is a 400', async () => {
    const r = await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({});
    expect(r.status).toBe(400);
  });

  it('POST with a private/loopback URL is refused (SSRF) and creates nothing', async () => {
    const r = await request(app)
      .post(`/api/agents/${agentId}/watches`)
      .set(auth(token))
      .send({ url: PRIVATE_URL });

    expect(r.status).toBe(400);
    expect(await prisma.watch.count({ where: { agentId } })).toBe(0);
    expect(await prisma.trigger.count({ where: { agentId } })).toBe(0);
  });

  it('GET lists only this agent’s watches', async () => {
    await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL, label: 'Mine' });
    // A second agent in the SAME org with its own watch — must not leak into the first.
    const otherAgentId = (await createAgent(orgId)).id;
    await request(app).post(`/api/agents/${otherAgentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL, label: 'Theirs' });

    const r = await request(app).get(`/api/agents/${agentId}/watches`).set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.watches).toHaveLength(1);
    expect(r.body.watches[0].label).toBe('Mine');
    expect(r.body.watches[0].agentId).toBe(agentId);
  });

  it('PATCH toggles active and disables the paired Trigger', async () => {
    const created = await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL });
    const watchId = created.body.id;
    const triggerId = created.body.triggerId;

    const off = await request(app).patch(`/api/agents/${agentId}/watches/${watchId}`).set(auth(token)).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect((await prisma.trigger.findUnique({ where: { id: triggerId } }))?.enabled).toBe(false);

    const on = await request(app).patch(`/api/agents/${agentId}/watches/${watchId}`).set(auth(token)).send({ active: true });
    expect(on.body.active).toBe(true);
    expect((await prisma.trigger.findUnique({ where: { id: triggerId } }))?.enabled).toBe(true);
  });

  it('PATCH an unknown watch is a 404', async () => {
    const r = await request(app).patch(`/api/agents/${agentId}/watches/does-not-exist`).set(auth(token)).send({ active: false });
    expect(r.status).toBe(404);
  });

  it('DELETE removes the watch and its Trigger', async () => {
    const created = await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL });
    const watchId = created.body.id;
    const triggerId = created.body.triggerId;

    const r = await request(app).delete(`/api/agents/${agentId}/watches/${watchId}`).set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(await prisma.watch.count({ where: { id: watchId } })).toBe(0);
    expect(await prisma.trigger.count({ where: { id: triggerId } })).toBe(0);
  });

  it('DELETE an unknown watch is a 404', async () => {
    const r = await request(app).delete(`/api/agents/${agentId}/watches/does-not-exist`).set(auth(token));
    expect(r.status).toBe(404);
  });

  it('cross-agent access is blocked — a watch is scoped to its own agent, not just the org', async () => {
    const created = await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL });
    const watchId = created.body.id;
    const triggerId = created.body.triggerId;

    // A sibling agent in the SAME org must not be able to mutate or delete this agent's watch
    // (the service scopes PATCH/DELETE by orgId AND agentId). Both return 404 and leave it intact.
    const otherAgentId = (await createAgent(orgId)).id;
    const patch = await request(app).patch(`/api/agents/${otherAgentId}/watches/${watchId}`).set(auth(token)).send({ active: false });
    expect(patch.status).toBe(404);
    const del = await request(app).delete(`/api/agents/${otherAgentId}/watches/${watchId}`).set(auth(token));
    expect(del.status).toBe(404);
    expect(await prisma.watch.count({ where: { id: watchId } })).toBe(1); // survived
    expect(await prisma.trigger.count({ where: { id: triggerId } })).toBe(1);
  });

  it('cross-org access is blocked — another org cannot read, toggle, or delete the watch', async () => {
    const created = await request(app).post(`/api/agents/${agentId}/watches`).set(auth(token)).send({ url: PUBLIC_URL });
    const watchId = created.body.id;
    const triggerId = created.body.triggerId;

    // A second org with its own owner + agent. It must not reach the first org's agent
    // (requireAgent → 404) nor, via its own agent route, the first org's watch (orgId scope → 404).
    const otherOrg = await createOrg();
    const otherToken = (await createUser(otherOrg.id, 'owner')).token;
    const otherAgentId = (await createAgent(otherOrg.id)).id;

    // Foreign org pointing at OUR agent id → requireAgent blocks it.
    expect((await request(app).get(`/api/agents/${agentId}/watches`).set(auth(otherToken))).status).toBe(404);
    expect((await request(app).patch(`/api/agents/${agentId}/watches/${watchId}`).set(auth(otherToken)).send({ active: false })).status).toBe(404);
    expect((await request(app).delete(`/api/agents/${agentId}/watches/${watchId}`).set(auth(otherToken))).status).toBe(404);

    // Foreign org via ITS OWN agent, aiming at our watch id → service orgId scope → 404.
    expect((await request(app).patch(`/api/agents/${otherAgentId}/watches/${watchId}`).set(auth(otherToken)).send({ active: false })).status).toBe(404);
    expect((await request(app).delete(`/api/agents/${otherAgentId}/watches/${watchId}`).set(auth(otherToken))).status).toBe(404);

    // The watch + trigger survive every blocked attempt.
    expect(await prisma.watch.count({ where: { id: watchId } })).toBe(1);
    expect(await prisma.trigger.count({ where: { id: triggerId } })).toBe(1);
  });
});
