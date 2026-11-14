// EWS-22/33/34 · OBS-18 · POL-17 — retention sweeps on the shared maintenance ticker, and spine
// metrics. Importing retention registers the sweeps; runMaintenanceOnce runs them against the DB.
import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '../src/lib/prisma';
import '../src/lib/retention';
import { runMaintenanceOnce, listSweeps } from '../src/lib/maintenance';
import { spineMetrics } from '../src/modules/workflows/service';
import { createOrg } from './helpers/factories';

const OLD = new Date(Date.now() - 100 * 86_400_000); // 100 days ago (> 90d window)
const NEW = new Date();

beforeEach(async () => {
  await prisma.workflowStepLog.deleteMany();
  await prisma.workflowRun.deleteMany();
  await prisma.job.deleteMany();
  await prisma.domainEvent.deleteMany();
  await prisma.usageEvent.deleteMany();
  await prisma.executionStep.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.outboundSendLog.deleteMany();
});

describe('maintenance ticker (EWS-34)', () => {
  it('registers the retention sweeps', () => {
    const names = listSweeps();
    for (const n of ['prune-domain-events', 'prune-jobs', 'prune-workflow-runs', 'prune-traces', 'expire-and-prune-approvals']) {
      expect(names).toContain(n);
    }
  });
});

describe('retention sweeps (EWS-33 / OBS-18)', () => {
  it('prunes processed events, terminal jobs/runs, and old traces past the window — keeping recent ones', async () => {
    const org = await createOrg();
    // processed (old) vs unprocessed (old) vs processed (new)
    await prisma.domainEvent.create({ data: { orgId: org.id, source: 's', type: 't', createdAt: OLD, processedAt: OLD } });
    await prisma.domainEvent.create({ data: { orgId: org.id, source: 's', type: 't', createdAt: OLD, processedAt: null } }); // unprocessed → kept
    await prisma.domainEvent.create({ data: { orgId: org.id, source: 's', type: 't', createdAt: NEW, processedAt: NEW } }); // recent → kept
    // terminal (old) vs pending (old) job
    await prisma.job.create({ data: { orgId: org.id, handlerName: 'h', status: 'completed', createdAt: OLD } });
    await prisma.job.create({ data: { orgId: org.id, handlerName: 'h', status: 'pending', createdAt: OLD } }); // in-flight → kept
    // terminal (old) run with a step, + an in-flight old run
    const doneRun = await prisma.workflowRun.create({ data: { orgId: org.id, workflowName: 'w', status: 'completed', finishedAt: OLD } });
    await prisma.workflowStepLog.create({ data: { runId: doneRun.id, stepName: 's', result: 'complete' } });
    await prisma.workflowRun.create({ data: { orgId: org.id, workflowName: 'w', status: 'running' } }); // in-flight → kept
    // old trace
    await prisma.usageEvent.create({ data: { orgId: org.id, agentId: 'a', createdAt: OLD, outcome: 'sent' } });

    await runMaintenanceOnce();

    expect(await prisma.domainEvent.count({ where: { orgId: org.id } })).toBe(2); // unprocessed-old + recent
    expect(await prisma.job.count({ where: { orgId: org.id } })).toBe(1); // pending kept
    expect(await prisma.workflowRun.count({ where: { orgId: org.id } })).toBe(1); // running kept
    expect(await prisma.workflowStepLog.count()).toBe(0); // cascade-deleted with the terminal run
    expect(await prisma.usageEvent.count({ where: { orgId: org.id } })).toBe(0);
  });

  it('expires a stale pending approval past its expiresAt (POL-17)', async () => {
    const org = await createOrg();
    const a = await prisma.approval.create({ data: { orgId: org.id, actionType: 'booking', status: 'pending', expiresAt: new Date(Date.now() - 1000) } });
    const fresh = await prisma.approval.create({ data: { orgId: org.id, actionType: 'booking', status: 'pending', expiresAt: new Date(Date.now() + 60_000) } });
    await runMaintenanceOnce();
    expect((await prisma.approval.findUnique({ where: { id: a.id } }))?.status).toBe('expired');
    expect((await prisma.approval.findUnique({ where: { id: fresh.id } }))?.status).toBe('pending'); // not yet due
  });
});

describe('spine metrics (EWS-22)', () => {
  it('reports queue depth, DLQ, and run outcomes org-scoped', async () => {
    const org = await createOrg();
    const other = await createOrg();
    await prisma.job.create({ data: { orgId: org.id, handlerName: 'h', status: 'pending', nextRunAt: new Date(Date.now() - 1000) } });
    await prisma.job.create({ data: { orgId: org.id, handlerName: 'h', status: 'dead' } });
    await prisma.job.create({ data: { orgId: other.id, handlerName: 'h', status: 'pending' } }); // other org → excluded
    await prisma.workflowRun.create({ data: { orgId: org.id, workflowName: 'w', status: 'completed', finishedAt: new Date() } });

    const m = await spineMetrics(org.id);
    expect(m.queueDepth).toBe(1);
    expect(m.dlq).toBe(1);
    expect(m.dueBacklog).toBe(1);
    expect(m.runsByStatus.completed).toBe(1);
  });
});
