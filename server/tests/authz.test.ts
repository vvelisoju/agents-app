// POL-03/04/14/15 / QA-22 — RBAC gating of privileged routes + audit trail.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import prisma from '../src/lib/prisma';
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

async function waitFor<T>(fn: () => Promise<T | null | undefined>, tries = 25): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const r = await fn();
    if (r) return r as T;
    await new Promise((res) => setTimeout(res, 25));
  }
  return null;
}

describe('RBAC on privileged routes', () => {
  it('denies a member destructive/admin actions; allows the owner', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const member = await createUser(org.id, 'member');
    const agent = await createAgent(org.id);

    // Member is blocked from destructive/admin/PII routes.
    expect((await request(app).delete(`/api/agents/${agent.id}`).set(auth(member.token))).status).toBe(403);
    expect((await request(app).patch('/api/org').set(auth(member.token)).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).get('/api/leads/export').set(auth(member.token))).status).toBe(403);
    expect((await request(app).get('/api/audit').set(auth(member.token))).status).toBe(403);

    // Owner can rename the org and it writes an audit row.
    const rename = await request(app).patch('/api/org').set(auth(owner.token)).send({ name: 'Renamed Co' });
    expect(rename.status).toBe(200);
    const row = await waitFor(() => prisma.auditLog.findFirst({ where: { orgId: org.id, action: 'org.rename' } }));
    expect(row).toBeTruthy();

    // Owner can read the audit trail.
    const auditRes = await request(app).get('/api/audit').set(auth(owner.token));
    expect(auditRes.status).toBe(200);
    expect(Array.isArray(auditRes.body.events)).toBe(true);
  });
});
