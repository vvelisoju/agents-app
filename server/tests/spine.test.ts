// EWS-28/15/11/09/13 — Phase-5 spine: envelope, registry, queue invariants (idempotency,
// backoff, DLQ, lease single-ownership), event dispatch, cron scheduling, and the
// off-by-default guarantee. Runs on the isolated SQLite test DB (proves EWS-11 parity).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import prisma from '../src/lib/prisma';
import { makeEvent } from '../src/events/envelope';
import { registerWorkflow, getWorkflow, listWorkflows, __setWorkflow } from '../src/workflow/registry';
import { Step } from '../src/workflow/types';
import { enqueueJob } from '../src/jobs/enqueue';
import { claimJobs } from '../src/jobs/claim';
import { runOnce, backoffMs } from '../src/jobs/runner';
import { drainEvents } from '../src/triggers/dispatcher';
import { tickCron } from '../src/jobs/scheduler';
import { cronNext } from '../src/jobs/cron';
import { emit } from '../src/events/emit';
import { createOrg } from './helpers/factories';

// The runner/scheduler/dispatcher are global (they process every org, as in prod), so a
// clean queue per test keeps the global-count assertions deterministic.
beforeEach(async () => {
  await prisma.workflowStepLog.deleteMany();
  await prisma.job.deleteMany();
  await prisma.domainEvent.deleteMany();
  await prisma.trigger.deleteMany();
  await prisma.workflowRun.deleteMany();
});

describe('spine — envelope (EWS-05)', () => {
  it('makeEvent is deterministic when id/time are supplied', () => {
    const e = makeEvent({ source: 's', type: 't', id: 'fixed', time: '2026-01-01T00:00:00.000Z', data: { a: 1 } });
    expect(e).toEqual({ id: 'fixed', source: 's', type: 't', time: '2026-01-01T00:00:00.000Z', subject: undefined, data: { a: 1 } });
  });
  it('defaults data to {} and generates id/time when omitted', () => {
    const e = makeEvent({ source: 's', type: 't' });
    expect(e.data).toEqual({});
    expect(e.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(e.time))).toBe(false);
  });
});

describe('spine — registry (EWS-08)', () => {
  it('registers, resolves, lists, and returns undefined for unknown', () => {
    __setWorkflow('spec.noop', async () => Step.complete());
    expect(getWorkflow('spec.noop')).toBeTypeOf('function');
    expect(listWorkflows()).toContain('spec.noop');
    expect(getWorkflow('does.not.exist')).toBeUndefined();
    __setWorkflow('spec.noop', null);
  });
  it('registerWorkflow rejects a duplicate name', () => {
    __setWorkflow('spec.dup', async () => Step.complete());
    expect(() => registerWorkflow('spec.dup', async () => Step.complete())).toThrow();
    __setWorkflow('spec.dup', null);
  });
});

describe('spine — queue invariants (EWS-03/10/28)', () => {
  let orgId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; });

  it('idempotencyKey blocks a duplicate enqueue', async () => {
    const a = await enqueueJob({ orgId, handlerName: 'h', idempotencyKey: 'dup-1' });
    const b = await enqueueJob({ orgId, handlerName: 'h', idempotencyKey: 'dup-1' });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(await prisma.job.count({ where: { orgId, idempotencyKey: 'dup-1' } })).toBe(1);
  });

  it('backoff grows exponentially and is capped', () => {
    expect(backoffMs(0)).toBe(2_000);
    expect(backoffMs(1)).toBe(4_000);
    expect(backoffMs(3)).toBe(16_000);
    expect(backoffMs(50)).toBe(5 * 60_000); // cap
  });

  it('a completing handler marks the job completed', async () => {
    __setWorkflow('spec.ok', async () => Step.complete({ ok: true }));
    await enqueueJob({ orgId, handlerName: 'spec.ok' });
    const r = await runOnce();
    expect(r.claimed).toBe(1);
    expect(r.completed).toBe(1);
    const job = await prisma.job.findFirst({ where: { orgId, handlerName: 'spec.ok' } });
    expect(job?.status).toBe('completed');
    __setWorkflow('spec.ok', null);
  });

  it('a retrying handler reschedules with backoff and increments attempts', async () => {
    __setWorkflow('spec.retry', async () => Step.retry(5_000, 'transient'));
    await enqueueJob({ orgId, handlerName: 'spec.retry' });
    await runOnce();
    const job = await prisma.job.findFirst({ where: { orgId, handlerName: 'spec.retry' } });
    expect(job?.status).toBe('pending');
    expect(job?.attempts).toBe(1);
    expect(job?.lease).toBeNull();
    expect(job!.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    __setWorkflow('spec.retry', null);
  });

  it('dead-letters at maxAttempts', async () => {
    __setWorkflow('spec.fail', async () => Step.retry(1, 'still broken'));
    await enqueueJob({ orgId, handlerName: 'spec.fail', maxAttempts: 1, nextRunAt: new Date(Date.now() - 1000) });
    await runOnce();
    const job = await prisma.job.findFirst({ where: { orgId, handlerName: 'spec.fail' } });
    expect(job?.status).toBe('dead');
    expect(job?.lastError).toContain('still broken');
    __setWorkflow('spec.fail', null);
  });

  it('an unknown handler is dead-lettered, not crashed', async () => {
    await enqueueJob({ orgId, handlerName: 'spec.ghost' });
    const r = await runOnce();
    expect(r.claimed).toBe(1);
    const job = await prisma.job.findFirst({ where: { orgId, handlerName: 'spec.ghost' } });
    expect(job?.status).toBe('dead');
    expect(job?.lastError).toContain('unknown handler');
  });

  it('a thrown handler becomes a retry (not a crash)', async () => {
    __setWorkflow('spec.throw', async () => { throw new Error('boom'); });
    await enqueueJob({ orgId, handlerName: 'spec.throw' });
    await runOnce();
    const job = await prisma.job.findFirst({ where: { orgId, handlerName: 'spec.throw' } });
    expect(job?.status).toBe('pending');
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain('boom');
    __setWorkflow('spec.throw', null);
  });

  it('lease gives single ownership under concurrent claimers (EWS-10/11)', async () => {
    await enqueueJob({ orgId, handlerName: 'h', nextRunAt: new Date(Date.now() - 1000) });
    const [a, b] = await Promise.all([claimJobs(10, 30_000), claimJobs(10, 30_000)]);
    expect(a.length + b.length).toBe(1); // exactly one claimer won
  });

  it('a crashed lease is reclaimable after leaseUntil (EWS-21)', async () => {
    await prisma.job.create({
      data: { orgId, handlerName: 'h', status: 'leased', lease: 'old', leaseUntil: new Date(Date.now() - 10_000), nextRunAt: new Date(Date.now() - 20_000) },
    });
    const claimed = await claimJobs(10, 30_000);
    expect(claimed.length).toBe(1);
    expect(claimed[0].lease).not.toBe('old');
  });
});

describe('spine — approval gate (EWS-12/23)', () => {
  it('awaitApproval parks the run and creates an Approval; nothing executes', async () => {
    const orgId = (await createOrg()).id;
    __setWorkflow('spec.gate', async () => Step.awaitApproval('booking', { slot: '10am' }));
    const run = await prisma.workflowRun.create({ data: { orgId, workflowName: 'spec.gate' } });
    await enqueueJob({ orgId, handlerName: 'spec.gate', workflowRunId: run.id });
    await runOnce();
    const after = await prisma.workflowRun.findUnique({ where: { id: run.id } });
    expect(after?.status).toBe('awaiting_approval');
    expect(after?.approvalId).toBeTruthy();
    const approval = await prisma.approval.findFirst({ where: { orgId, actionType: 'booking' } });
    expect(approval?.status).toBe('pending');
    __setWorkflow('spec.gate', null);
  });
});

describe('spine — dispatcher (EWS-09)', () => {
  let orgId: string;
  beforeEach(async () => { orgId = (await createOrg()).id; });

  it('enqueues exactly one job per matching trigger and is idempotent on re-drain', async () => {
    await prisma.trigger.create({ data: { orgId, kind: 'event', eventType: 'lead.created', handlerName: 'spec.lead' } });
    const ev = await prisma.domainEvent.create({ data: { orgId, source: 'test', type: 'lead.created', dataJson: '{}' } });
    const first = await drainEvents();
    expect(first.enqueued).toBe(1);
    expect((await prisma.domainEvent.findUnique({ where: { id: ev.id } }))?.processedAt).toBeTruthy();
    // Re-draining does nothing (event already processed); and the idempotencyKey would block a dup anyway.
    const again = await drainEvents();
    expect(again.processed).toBe(0);
    expect(await prisma.job.count({ where: { orgId, handlerName: 'spec.lead' } })).toBe(1);
  });

  it('marks a no-match event processed without enqueuing', async () => {
    await prisma.domainEvent.create({ data: { orgId, source: 'test', type: 'nobody.listens', dataJson: '{}' } });
    const r = await drainEvents();
    expect(r.processed).toBe(1);
    expect(r.enqueued).toBe(0);
  });

  it('respects the trigger filter', async () => {
    await prisma.trigger.create({ data: { orgId, kind: 'event', eventType: 'msg', handlerName: 'spec.h', filterJson: JSON.stringify({ intent: 'buy' }) } });
    await prisma.domainEvent.create({ data: { orgId, source: 't', type: 'msg', dataJson: JSON.stringify({ intent: 'browse' }) } });
    await prisma.domainEvent.create({ data: { orgId, source: 't', type: 'msg', dataJson: JSON.stringify({ intent: 'buy' }) } });
    const r = await drainEvents();
    expect(r.enqueued).toBe(1); // only the 'buy' event matched
  });

  it('does not cross tenants', async () => {
    const other = (await createOrg()).id;
    await prisma.trigger.create({ data: { orgId, kind: 'event', eventType: 'x', handlerName: 'spec.h' } });
    await prisma.domainEvent.create({ data: { orgId: other, source: 't', type: 'x', dataJson: '{}' } });
    const r = await drainEvents();
    expect(r.enqueued).toBe(0); // other-org event never matches this org's trigger
  });
});

describe('spine — scheduler (EWS-13)', () => {
  it('enqueues a due cron trigger once, even across overlapping ticks', async () => {
    const orgId = (await createOrg()).id;
    await prisma.trigger.create({ data: { orgId, kind: 'cron', cronExpr: '*/5 * * * *', handlerName: 'spec.cron' } });
    const now = new Date();
    const a = await tickCron(now);
    const b = await tickCron(now); // same minute → idempotencyKey blocks a dup
    expect(a.enqueued).toBe(1);
    expect(b.enqueued).toBe(0);
    expect(await prisma.job.count({ where: { orgId, handlerName: 'spec.cron' } })).toBe(1);
    // nextRunAt advanced into the future.
    const t = await prisma.trigger.findFirst({ where: { orgId, handlerName: 'spec.cron' } });
    expect(t!.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  it('never fires a disabled trigger', async () => {
    const orgId = (await createOrg()).id;
    await prisma.trigger.create({ data: { orgId, kind: 'cron', cronExpr: '* * * * *', handlerName: 'spec.off', enabled: false } });
    const r = await tickCron(new Date());
    expect(r.enqueued).toBe(0);
  });
});

describe('spine — cron evaluator (EWS-13)', () => {
  it('computes the next */5 minute slot', () => {
    const next = cronNext('*/5 * * * *', new Date('2026-01-01T10:02:00'));
    expect(next.getMinutes()).toBe(5);
  });
  it('computes a daily-at time', () => {
    const next = cronNext('30 9 * * *', new Date('2026-01-01T10:00:00'));
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(30);
    expect(next.getDate()).toBe(2); // rolled to the next day
  });
});

describe('spine — off by default (EWS-06/15)', () => {
  const prev = process.env.WORKFLOW_ENABLED;
  afterEach(() => { if (prev === undefined) delete process.env.WORKFLOW_ENABLED; else process.env.WORKFLOW_ENABLED = prev; });

  it('emit() writes nothing when WORKFLOW_ENABLED is off', async () => {
    delete process.env.WORKFLOW_ENABLED;
    const orgId = (await createOrg()).id;
    await emit({ orgId, source: 'engine', type: 'message.received', data: { x: 1 } });
    expect(await prisma.domainEvent.count({ where: { orgId } })).toBe(0);
  });

  it('emit() writes an outbox row when enabled', async () => {
    process.env.WORKFLOW_ENABLED = '1';
    const orgId = (await createOrg()).id;
    await emit({ orgId, source: 'engine', type: 'message.received', data: { x: 1 } });
    expect(await prisma.domainEvent.count({ where: { orgId } })).toBe(1);
  });
});
