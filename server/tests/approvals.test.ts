// POL-07/08/09 — generalized approval queue: list, idempotent approve/reject.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { createApproval, decideApproval } from '../src/policy/approvals';
import prisma from '../src/lib/prisma';
import { createOrg, createUser, createAgent } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('approval queue', () => {
  it('lists, approves idempotently, and rejects', async () => {
    const org = await createOrg();
    const owner = await createUser(org.id, 'owner');
    const a1 = await createApproval({ orgId: org.id, actionType: 'bulk_send', payload: { count: 10 } });
    const a2 = await createApproval({ orgId: org.id, actionType: 'booking' });

    const list = await request(app).get('/api/approvals').set(auth(owner.token));
    expect(list.status).toBe(200);
    expect(list.body.approvals.length).toBe(2);

    const ok = await request(app).post(`/api/approvals/${a1.id}/approve`).set(auth(owner.token));
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('approved');

    // Idempotent: approving again is a 409, not a second execution.
    const again = await request(app).post(`/api/approvals/${a1.id}/approve`).set(auth(owner.token));
    expect(again.status).toBe(409);

    const rej = await request(app).post(`/api/approvals/${a2.id}/reject`).set(auth(owner.token));
    expect(rej.status).toBe(200);
    expect(rej.body.status).toBe('rejected');

    // Pending list is now empty.
    const pending = await request(app).get('/api/approvals').set(auth(owner.token));
    expect(pending.body.approvals.length).toBe(0);
  });

  it('allows a member the approve action (staff approve day-to-day items)', async () => {
    const org = await createOrg();
    const member = await createUser(org.id, 'member');
    const a = await createApproval({ orgId: org.id, actionType: 'send_reply' });
    const res = await request(app).post(`/api/approvals/${a.id}/approve`).set(auth(member.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  // OBS-16 — resolving an approval flips the originating execution step's approvalState.
  it('syncs the execution step trace when its approval is decided', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    await prisma.executionStep.create({
      data: { orgId: org.id, agentId: agent.id, executionId: 'exec-appr', stepIndex: 0, toolName: 'data.action', outcome: 'pending_approval', approvalState: 'pending_approval' },
    });
    const a = await createApproval({ orgId: org.id, agentId: agent.id, actionType: 'data_write', payload: { tool: 'data.action', input: {}, executionId: 'exec-appr', stepIndex: 0 } });

    await decideApproval(org.id, a.id, 'approved');
    const step = await prisma.executionStep.findFirst({ where: { orgId: org.id, executionId: 'exec-appr', stepIndex: 0 } });
    expect(step?.approvalState).toBe('approved');
  });

  it('404s an approval from another org (tenant isolation)', async () => {
    const orgA = await createOrg();
    const ownerA = await createUser(orgA.id, 'owner');
    const orgB = await createOrg();
    const b = await createApproval({ orgId: orgB.id, actionType: 'booking' });
    const res = await request(app).post(`/api/approvals/${b.id}/approve`).set(auth(ownerA.token));
    expect(res.status).toBe(404);
  });
});
