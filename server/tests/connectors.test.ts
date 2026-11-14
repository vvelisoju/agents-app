// Configurable connectors — management API (secrets write-only), the data.query/data.action tools
// (owner-defined ops, access gating), REST execution with safe param binding, and describeOps.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { encryptSecret } from '../src/lib/crypto';
import { dataQuery, dataAction } from '../src/tools/builtin/data';
import { opsForAgent, describeOps } from '../src/lib/connectors';
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('connector management API', () => {
  it('creates a connector (secret never returned), adds an op, lists, and deletes', async () => {
    const org = await createOrg();
    const token = (await createUser(org.id, 'owner')).token;

    const c = await request(app).post('/api/connectors').set(auth(token))
      .send({ name: 'Leads DB', kind: 'postgres', secret: 'postgres://user:pass@host/db' });
    expect(c.status).toBe(200);
    expect(JSON.stringify(c.body)).not.toContain('pass'); // secret not echoed

    const list = await request(app).get('/api/connectors').set(auth(token));
    expect(list.body.connectors[0].name).toBe('Leads DB');
    expect(list.body.connectors[0]).not.toHaveProperty('secretEnc');

    const op = await request(app).post(`/api/connectors/${c.body.id}/ops`).set(auth(token)).send({
      name: 'get_lead_by_phone', description: 'Look up a lead by phone', access: 'customer', sideEffect: 'read',
      spec: { sql: 'SELECT name, status FROM leads WHERE phone = $1', params: [{ name: 'phone', type: 'string' }] },
    });
    expect(op.status).toBe(200);
    const ops = await request(app).get(`/api/connectors/${c.body.id}/ops`).set(auth(token));
    expect(ops.body.ops[0].name).toBe('get_lead_by_phone');

    expect((await request(app).delete(`/api/connectors/${c.body.id}`).set(auth(token))).status).toBe(200);
    expect(await prisma.connector.count({ where: { id: c.body.id } })).toBe(0);
  });

  it('test endpoint validates a REST connector config', async () => {
    const org = await createOrg();
    const token = (await createUser(org.id, 'owner')).token;
    const c = await request(app).post('/api/connectors').set(auth(token)).send({ name: 'api', kind: 'rest', secret: JSON.stringify({ baseUrl: 'https://api.example.com' }) });
    const ok = await request(app).post(`/api/connectors/${c.body.id}/test`).set(auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    const bad = await request(app).post('/api/connectors').set(auth(token)).send({ name: 'api2', kind: 'rest', secret: JSON.stringify({ baseUrl: 'not-a-url' }) });
    expect((await request(app).post(`/api/connectors/${bad.body.id}/test`).set(auth(token))).body.ok).toBe(false);
  });

  it('forbids a member from creating a connector', async () => {
    const org = await createOrg();
    const member = (await createUser(org.id, 'member')).token;
    const r = await request(app).post('/api/connectors').set(auth(member)).send({ name: 'x', kind: 'rest', secret: '{}' });
    expect(r.status).toBe(403);
  });
});

describe('access gating', () => {
  it('opsForAgent excludes admin ops for a customer agent', async () => {
    const org = await createOrg();
    const conn = await prisma.connector.create({ data: { orgId: org.id, name: 'c', kind: 'postgres', secretEnc: encryptSecret('x') } });
    await prisma.connectorOp.create({ data: { orgId: org.id, connectorId: conn.id, name: 'pub', description: 'd', access: 'customer', sideEffect: 'read', specJson: '{}' } });
    await prisma.connectorOp.create({ data: { orgId: org.id, connectorId: conn.id, name: 'secret', description: 'd', access: 'admin', sideEffect: 'read', specJson: '{}' } });
    expect((await opsForAgent(org.id, 'customer', 'read')).map((o) => o.name)).toEqual(['pub']);
    expect((await opsForAgent(org.id, 'admin', 'read')).map((o) => o.name).sort()).toEqual(['pub', 'secret']);
  });
});

describe('data.query tool over a REST connector', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('resolves the op, builds the URL with encoded params, and returns data', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { connectorAccess: 'customer' } as any);
    const conn = await prisma.connector.create({ data: { orgId: org.id, name: 'api', kind: 'rest', secretEnc: encryptSecret(JSON.stringify({ baseUrl: 'https://api.example.com', headers: { 'X-Key': 'k' } })) } });
    await prisma.connectorOp.create({ data: { orgId: org.id, connectorId: conn.id, name: 'order_status', description: 'Order status', access: 'customer', sideEffect: 'read', specJson: JSON.stringify({ method: 'GET', path: '/orders/{id}', params: [{ name: 'id', type: 'string' }] }) } });

    let calledUrl = '';
    globalThis.fetch = vi.fn(async (url: any) => { calledUrl = String(url); return { ok: true, status: 200, json: async () => ({ status: 'shipped' }) } as any; }) as any;

    const r: any = await dataQuery.execute({ operation: 'order_status', params: { id: 'A B/42' } } as any, { agent, orgId: org.id } as any);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ status: 'shipped' });
    expect(calledUrl).toBe('https://api.example.com/orders/A%20B%2F42'); // param URL-encoded (no path breakout)
  });

  it('refuses an operation the agent is not allowed to run, until it is granted admin access', async () => {
    const org = await createOrg();
    const token = (await createUser(org.id, 'owner')).token;
    const agent = await createAgent(org.id, { connectorAccess: 'customer' } as any);
    const conn = await prisma.connector.create({ data: { orgId: org.id, name: 'db', kind: 'rest', secretEnc: encryptSecret(JSON.stringify({ baseUrl: 'https://api.example.com' })) } });
    await prisma.connectorOp.create({ data: { orgId: org.id, connectorId: conn.id, name: 'admin_lookup', description: 'd', access: 'admin', sideEffect: 'read', specJson: JSON.stringify({ method: 'GET', path: '/x', params: [] }) } });

    // Customer agent → denied.
    const denied: any = await dataQuery.execute({ operation: 'admin_lookup' } as any, { agent, orgId: org.id } as any);
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('no such');

    // Grant admin access via the agent PATCH, then it resolves the op.
    await request(app).patch(`/api/agents/${agent.id}`).set(auth(token)).send({ connectorAccess: 'admin' });
    const adminAgent = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect((adminAgent as any).connectorAccess).toBe('admin');
    const ops = await opsForAgent(org.id, 'admin', 'read');
    expect(ops.map((o) => o.name)).toContain('admin_lookup');
  });
});

describe('describeOps', () => {
  it('lists read + write operations for the prompt', () => {
    const reads = [{ name: 'get_lead', description: 'find a lead', specJson: JSON.stringify({ params: [{ name: 'phone' }] }) }];
    const writes = [{ name: 'set_status', description: 'update status', specJson: JSON.stringify({ params: [{ name: 'id' }, { name: 'status' }] }) }];
    const s = describeOps(reads, writes);
    expect(s).toContain('data.query');
    expect(s).toContain('get_lead(phone)');
    expect(s).toContain('data.action');
    expect(s).toContain('set_status(id, status)');
  });
});
