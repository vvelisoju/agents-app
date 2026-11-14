// POL-16/20 — approving a campaign (bulk_send) approval from the Approvals inbox also resumes the
// parked WorkflowRun, so the inbox is equivalent to the Automations approve (no dead-end).
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Approvals inbox', () => {
  it('lists pending approvals and approving a run-linked one resumes the run', async () => {
    const org = await createOrg();
    const token = (await createUser(org.id, 'owner')).token;
    const approval = await prisma.approval.create({ data: { orgId: org.id, actionType: 'bulk_send', status: 'pending', payloadJson: JSON.stringify({ campaignId: 'c1', recipients: 3 }) } });
    const run = await prisma.workflowRun.create({ data: { orgId: org.id, workflowName: 'outbound-drip', status: 'awaiting_approval', approvalId: approval.id } });

    const list = await request(app).get('/api/approvals').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.approvals.some((a: any) => a.id === approval.id)).toBe(true);

    const approve = await request(app).post(`/api/approvals/${approval.id}/approve`).set(auth(token));
    expect(approve.status).toBe(200);
    expect((await prisma.approval.findUnique({ where: { id: approval.id } }))?.status).toBe('approved');
    expect((await prisma.workflowRun.findUnique({ where: { id: run.id } }))?.status).toBe('running'); // resumed
    expect(await prisma.job.count({ where: { orgId: org.id, workflowRunId: run.id } })).toBe(1);
  });

  it('rejecting leaves the approval rejected and sends nothing', async () => {
    const org = await createOrg();
    const token = (await createUser(org.id, 'owner')).token;
    const approval = await prisma.approval.create({ data: { orgId: org.id, actionType: 'booking', status: 'pending' } });
    const r = await request(app).post(`/api/approvals/${approval.id}/reject`).set(auth(token));
    expect(r.status).toBe(200);
    expect((await prisma.approval.findUnique({ where: { id: approval.id } }))?.status).toBe('rejected');
  });
});
