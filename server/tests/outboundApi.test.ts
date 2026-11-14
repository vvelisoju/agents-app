// SCN-40 — outbound HTTP surface: /api/agents/:id/outbound/*. Connection upsert never
// leaks the raw token (only hasToken); activation is blocked until a persisted risk
// acknowledgement exists; starting a campaign parks a WorkflowRun at awaiting_approval +
// a pending bulk_send Approval and sends NOTHING (asserted via the capturing 'test'
// channel). Progress + opt-out listing are read-only. Offline: no real network.
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser, createAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Outbound API (/api/agents/:id/outbound/*)', () => {
  const prev = process.env.OUTBOUND_ENABLED;
  beforeAll(() => { process.env.OUTBOUND_ENABLED = '1'; });
  afterAll(() => { if (prev === undefined) delete process.env.OUTBOUND_ENABLED; else process.env.OUTBOUND_ENABLED = prev; });

  let orgId: string;
  let token: string;
  let agentId: string;

  beforeEach(async () => {
    const org = await createOrg();
    orgId = org.id;
    token = (await createUser(orgId, 'owner')).token;
    agentId = (await createAgent(orgId, { channelType: 'test' })).id;
    resetSends();
  });

  it('upserts a connection and never returns the raw token (only hasToken)', async () => {
    const r = await request(app)
      .post(`/api/agents/${agentId}/outbound/connection`)
      .set(auth(token))
      .send({ token: 'super-secret-trackly-token', dailyCap: 25 });

    expect(r.status).toBe(200);
    expect(r.body.connection).toBeTruthy();
    expect(r.body.connection.hasToken).toBe(true);
    expect(r.body.connection.dailyCap).toBe(25);
    // The raw/encrypted token must never cross the wire.
    expect(r.body.connection.tokenEnc).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('super-secret-trackly-token');
  });

  it('activation needs a risk acknowledgement; with acceptRisk then active:true it succeeds', async () => {
    // Connection created WITHOUT acceptRisk → activation is refused.
    await request(app)
      .post(`/api/agents/${agentId}/outbound/connection`)
      .set(auth(token))
      .send({ token: 't' })
      .expect(200);

    const blocked = await request(app)
      .post(`/api/agents/${agentId}/outbound/connection/active`)
      .set(auth(token))
      .send({ active: true });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe('risk_ack_required');

    // Acknowledge the risk through the API (not raw prisma), then activation succeeds.
    const acked = await request(app)
      .post(`/api/agents/${agentId}/outbound/connection`)
      .set(auth(token))
      .send({ acceptRisk: true });
    expect(acked.status).toBe(200);
    expect(acked.body.connection.riskAckAt).toBeTruthy();

    const active = await request(app)
      .post(`/api/agents/${agentId}/outbound/connection/active`)
      .set(auth(token))
      .send({ active: true });
    expect(active.status).toBe(200);
    expect(active.body.ok).toBe(true);
  });

  it('starting a campaign parks a run + pending approval and sends NOTHING', async () => {
    // Active, risk-acked connection — created entirely through the API.
    await request(app)
      .post(`/api/agents/${agentId}/outbound/connection`)
      .set(auth(token))
      .send({ token: 't', acceptRisk: true })
      .expect(200);
    await request(app)
      .post(`/api/agents/${agentId}/outbound/connection/active`)
      .set(auth(token))
      .send({ active: true })
      .expect(200);

    const r = await request(app)
      .post(`/api/agents/${agentId}/outbound/campaigns`)
      .set(auth(token))
      .send({ promo: 'New hot-desk launch offer', recipients: [{ phone: '9876543210', name: 'A' }, { phone: '9876543211' }] });

    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.runId).toBeTruthy();
    expect(r.body.approvalId).toBeTruthy();
    expect(r.body.recipients).toBe(2);

    // The run is parked awaiting approval — nothing runs yet.
    const run = await prisma.workflowRun.findUnique({ where: { id: r.body.runId } });
    expect(run?.status).toBe('awaiting_approval');
    expect(run?.workflowName).toBe('outbound-drip');
    expect(run?.approvalId).toBe(r.body.approvalId);

    // A pending bulk_send approval gates the send.
    const approval = await prisma.approval.findUnique({ where: { id: r.body.approvalId } });
    expect(approval?.actionType).toBe('bulk_send');
    expect(approval?.status).toBe('pending');

    // Nothing was sent — the capturing 'test' channel saw zero sends.
    expect(sends).toHaveLength(0);
  });

  it('returns progress counts for a started campaign', async () => {
    await request(app)
      .post(`/api/agents/${agentId}/outbound/connection`)
      .set(auth(token))
      .send({ token: 't', acceptRisk: true })
      .expect(200);
    await request(app)
      .post(`/api/agents/${agentId}/outbound/connection/active`)
      .set(auth(token))
      .send({ active: true })
      .expect(200);
    const started = await request(app)
      .post(`/api/agents/${agentId}/outbound/campaigns`)
      .set(auth(token))
      .send({ promo: 'Offer', recipients: [{ phone: '9876543210' }, { phone: '9876543211' }] })
      .expect(200);

    const p = await request(app)
      .get(`/api/agents/${agentId}/outbound/campaigns/${started.body.runId}`)
      .set(auth(token));
    expect(p.status).toBe(200);
    expect(p.body.runId).toBe(started.body.runId);
    expect(p.body.status).toBe('awaiting_approval');
    expect(p.body.total).toBe(2);
    expect(p.body.counts).toMatchObject({ sent: 0, delivered: 0, read: 0, failed: 0, opted_out: 0 });

    // Unknown run id → 404.
    const missing = await request(app)
      .get(`/api/agents/${agentId}/outbound/campaigns/does-not-exist`)
      .set(auth(token));
    expect(missing.status).toBe(404);
  });

  it('lists opt-outs for the agent', async () => {
    await prisma.outboundOptOut.create({ data: { orgId, agentId, phone: '9000000001' } });
    await prisma.outboundOptOut.create({ data: { orgId, agentId, phone: '9000000002' } });
    // Another agent's opt-out must not leak in.
    const otherAgentId = (await createAgent(orgId, { channelType: 'test' })).id;
    await prisma.outboundOptOut.create({ data: { orgId, agentId: otherAgentId, phone: '9000000003' } });

    const r = await request(app)
      .get(`/api/agents/${agentId}/outbound/optouts`)
      .set(auth(token));
    expect(r.status).toBe(200);
    const phones = r.body.optOuts.map((o: any) => o.phone);
    expect(phones).toHaveLength(2);
    expect(phones).toEqual(expect.arrayContaining(['9000000001', '9000000002']));
    expect(phones).not.toContain('9000000003');
  });
});
