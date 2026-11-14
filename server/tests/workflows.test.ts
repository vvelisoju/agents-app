// EWS-18/19/29 — workflow runs read + idempotent controls, tenant-scoped.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import prisma from '../src/lib/prisma';
import { buildApp } from '../src/app';
import { createOrg, createUser } from './helpers/factories';

const app = buildApp();
const auth = (t: string) => ({ Authorization: 'Bearer ' + t });

describe('Workflow runs API', () => {
  let orgId: string;
  let token: string;

  beforeEach(async () => {
    const org = await createOrg();
    orgId = org.id;
    token = (await createUser(orgId, 'owner')).token;
  });

  it('lists only the caller org’s runs', async () => {
    await prisma.workflowRun.create({ data: { orgId, workflowName: 'w.mine' } });
    const other = await createOrg();
    await prisma.workflowRun.create({ data: { orgId: other.id, workflowName: 'w.theirs' } });

    const r = await request(app).get('/api/workflows').set(auth(token));
    expect(r.status).toBe(200);
    const names = r.body.runs.map((x: any) => x.workflowName);
    expect(names).toContain('w.mine');
    expect(names).not.toContain('w.theirs');
  });

  it('returns a run with its step timeline; cross-tenant is 404', async () => {
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w', currentStep: 's1' } });
    await prisma.workflowStepLog.create({ data: { runId: run.id, stepName: 'started', result: 'log' } });

    const ok = await request(app).get(`/api/workflows/${run.id}`).set(auth(token));
    expect(ok.status).toBe(200);
    expect(ok.body.run.id).toBe(run.id);
    expect(ok.body.steps).toHaveLength(1);

    const other = await createUser((await createOrg()).id, 'owner');
    const cross = await request(app).get(`/api/workflows/${run.id}`).set(auth(other.token));
    expect(cross.status).toBe(404);
  });

  it('pause is idempotent and stops an active run', async () => {
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w', status: 'running' } });
    const a = await request(app).post(`/api/workflows/${run.id}/pause`).set(auth(token));
    expect(a.status).toBe(200);
    expect(a.body.run.status).toBe('paused');
    expect(a.body.changed).toBe(true);
    const b = await request(app).post(`/api/workflows/${run.id}/pause`).set(auth(token));
    expect(b.status).toBe(200);
    expect(b.body.changed).toBe(false); // already paused → no-op
  });

  it('cancel is terminal; a completed run cannot be paused', async () => {
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w', status: 'running' } });
    const c = await request(app).post(`/api/workflows/${run.id}/cancel`).set(auth(token));
    expect(c.body.run.status).toBe('canceled');
    const p = await request(app).post(`/api/workflows/${run.id}/pause`).set(auth(token));
    expect(p.status).toBe(409); // invalid transition from terminal
  });

  it('approve resumes an awaiting_approval run, decides its approval, and enqueues a resume job', async () => {
    const approval = await prisma.approval.create({ data: { orgId, actionType: 'booking', status: 'pending' } });
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w.book', status: 'awaiting_approval', approvalId: approval.id } });

    const r = await request(app).post(`/api/workflows/${run.id}/approve`).set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.run.status).toBe('running');
    expect((await prisma.approval.findUnique({ where: { id: approval.id } }))?.status).toBe('approved');
    expect(await prisma.job.count({ where: { orgId, workflowRunId: run.id } })).toBe(1);

    // Second approve is a no-op (idempotent) and never double-enqueues.
    const again = await request(app).post(`/api/workflows/${run.id}/approve`).set(auth(token));
    expect(again.status).toBe(200);
    expect(again.body.changed).toBe(false);
    expect(await prisma.job.count({ where: { orgId, workflowRunId: run.id } })).toBe(1);
  });

  it('rejects an unknown action and a missing run', async () => {
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w', status: 'running' } });
    expect((await request(app).post(`/api/workflows/${run.id}/frobnicate`).set(auth(token))).status).toBe(400);
    expect((await request(app).post('/api/workflows/does-not-exist/pause').set(auth(token))).status).toBe(404);
  });

  // EWS-21 — dead-letter queue: list dead jobs and replay one back to pending.
  it('lists dead jobs and replays one back to pending (resuming its run)', async () => {
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'w.dead', status: 'failed', finishedAt: new Date() } });
    const job = await prisma.job.create({ data: { orgId, workflowRunId: run.id, handlerName: 'noop', status: 'dead', attempts: 5, lastError: 'boom' } });
    const other = await createOrg();
    await prisma.job.create({ data: { orgId: other.id, handlerName: 'noop', status: 'dead' } });

    const list = await request(app).get('/api/workflows/dlq').set(auth(token));
    expect(list.status).toBe(200);
    expect(list.body.jobs.map((j: any) => j.id)).toEqual([job.id]); // org-scoped

    const replay = await request(app).post(`/api/workflows/dlq/${job.id}/replay`).set(auth(token));
    expect(replay.status).toBe(200);
    expect(replay.body.job.status).toBe('pending');
    expect(replay.body.job.attempts).toBe(0);

    const refreshed = await prisma.job.findUnique({ where: { id: job.id } });
    expect(refreshed?.status).toBe('pending');
    expect(refreshed?.lastError).toBeNull();
    expect((await prisma.workflowRun.findUnique({ where: { id: run.id } }))?.status).toBe('running');

    // Replaying a now-pending (not dead) job → 404.
    expect((await request(app).post(`/api/workflows/dlq/${job.id}/replay`).set(auth(token))).status).toBe(404);
  });
});
