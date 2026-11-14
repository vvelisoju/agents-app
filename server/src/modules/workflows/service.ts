// EWS-18/19 — workflow run reads + idempotent control transitions. Pause stops further steps;
// cancel is terminal; resume/approve re-enqueue a Job so the runner continues the parked run.
// Approve additionally decides the linked Approval server-side (re-authorization) — no
// model-emitted token ever resumes a gated run. Every control is idempotent and audited.
import type { WorkflowRun } from '@prisma/client';
import prisma from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { enqueueJob } from '../../jobs/enqueue';
import { decideApproval } from '../../policy/approvals';
import { emit as wsEmit } from '../../lib/realtime';

const TERMINAL = ['completed', 'failed', 'canceled'];
const ACTIVE = ['running', 'sleeping'];

export type ControlAction = 'pause' | 'resume' | 'cancel' | 'approve';
export interface ControlResult {
  ok: boolean;
  run?: WorkflowRun;
  changed?: boolean;
  reason?: 'not_found' | 'invalid_transition';
  status?: string;
}

// EWS-22 — spine metrics (org-scoped): queue depth, DLQ, run-outcome breakdown.
export async function spineMetrics(orgId: string) {
  const [jobsByStatus, runsByStatus, dueBacklog] = await Promise.all([
    prisma.job.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
    prisma.workflowRun.groupBy({ by: ['status'], where: { orgId }, _count: { _all: true } }),
    prisma.job.count({ where: { orgId, status: 'pending', nextRunAt: { lte: new Date() } } }),
  ]);
  const jobs: Record<string, number> = {};
  for (const r of jobsByStatus) jobs[r.status] = r._count._all;
  const runs: Record<string, number> = {};
  for (const r of runsByStatus) runs[r.status] = r._count._all;
  return {
    queueDepth: jobs.pending || 0,
    leased: jobs.leased || 0,
    running: jobs.running || 0,
    dlq: jobs.dead || 0,
    dueBacklog,
    jobsByStatus: jobs,
    runsByStatus: runs,
  };
}

// EWS-21 — dead-letter queue. List dead jobs (org-scoped, newest first) and replay one:
// requeue it as pending with a fresh attempt budget so the runner picks it up again. The
// parked WorkflowRun (if any) is flipped back to 'running' so its timeline resumes. Replay
// is auditable and 404s a job that isn't this org's or isn't actually dead.
export function listDeadJobs(orgId: string, limit = 100) {
  return prisma.job.findMany({ where: { orgId, status: 'dead' }, orderBy: { updatedAt: 'desc' }, take: Math.min(500, limit) });
}

export async function replayDeadJob(orgId: string, jobId: string, userId?: string): Promise<{ ok: boolean; reason?: 'not_found'; job?: any }> {
  const job = await prisma.job.findFirst({ where: { id: jobId, orgId, status: 'dead' } });
  if (!job) return { ok: false, reason: 'not_found' };
  const requeued = await prisma.job.update({
    where: { id: job.id },
    data: { status: 'pending', attempts: 0, nextRunAt: new Date(), lease: null, leaseUntil: null, lastError: null },
  });
  if (job.workflowRunId) {
    await prisma.workflowRun.update({ where: { id: job.workflowRunId }, data: { status: 'running', finishedAt: null } }).catch(() => {});
  }
  audit({ orgId, actorUserId: userId, action: 'job.replay', targetType: 'job', targetId: job.id, metadata: { handler: job.handlerName } });
  return { ok: true, job: requeued };
}

export function listRuns(orgId: string, opts: { agentId?: string; status?: string; limit?: number } = {}) {
  return prisma.workflowRun.findMany({
    where: { orgId, ...(opts.agentId ? { agentId: opts.agentId } : {}), ...(opts.status ? { status: opts.status } : {}) },
    orderBy: { startedAt: 'desc' },
    take: opts.limit ?? 100,
  });
}

export async function getRun(orgId: string, runId: string) {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, orgId } });
  if (!run) return null;
  const steps = await prisma.workflowStepLog.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  return { run, steps };
}

// Re-enqueue a Job so the runner picks the run back up. idempotencyKey ties the resume to the
// run's current parked state so a double resume/approve can't double-enqueue.
async function resumeJob(run: WorkflowRun): Promise<void> {
  await enqueueJob({
    orgId: run.orgId,
    handlerName: run.workflowName,
    workflowRunId: run.id,
    idempotencyKey: `resume:${run.id}:${run.approvalId ?? run.updatedAt.getTime()}`,
    state: { resumedRun: run.id },
  });
}

async function transition(run: WorkflowRun, status: string, userId: string, step: string, terminal = false): Promise<WorkflowRun> {
  const updated = await prisma.workflowRun.update({
    where: { id: run.id },
    data: { status, ...(terminal ? { finishedAt: new Date() } : {}) },
  });
  await prisma.workflowStepLog.create({ data: { runId: run.id, stepName: step, result: 'control', detailJson: JSON.stringify({ by: userId }) } });
  audit({ orgId: run.orgId, actorUserId: userId, action: `workflow.${step}`, targetType: 'workflow_run', targetId: run.id });
  // EWS-26: push a live run-status update to any subscribed browser (keyed by the run's agent).
  if (run.agentId) { try { wsEmit(run.agentId, 'workflow', { runId: run.id, status }); } catch { /* never block a control */ } }
  return updated;
}

export async function controlRun(orgId: string, runId: string, action: ControlAction, userId: string): Promise<ControlResult> {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, orgId } });
  if (!run) return { ok: false, reason: 'not_found' };
  const s = run.status;

  switch (action) {
    case 'pause':
      if (s === 'paused') return { ok: true, run, changed: false };
      if (!ACTIVE.includes(s)) return { ok: false, reason: 'invalid_transition', status: s };
      return { ok: true, run: await transition(run, 'paused', userId, 'paused'), changed: true };

    case 'resume':
      if (ACTIVE.includes(s)) return { ok: true, run, changed: false };
      if (s !== 'paused') return { ok: false, reason: 'invalid_transition', status: s };
      await resumeJob(run);
      return { ok: true, run: await transition(run, 'running', userId, 'resumed'), changed: true };

    case 'cancel':
      if (s === 'canceled') return { ok: true, run, changed: false };
      if (TERMINAL.includes(s)) return { ok: false, reason: 'invalid_transition', status: s };
      return { ok: true, run: await transition(run, 'canceled', userId, 'canceled', true), changed: true };

    case 'approve':
      // Already resumed/active/done → idempotent success. Only awaiting_approval actually resumes.
      if (ACTIVE.includes(s) || s === 'completed') return { ok: true, run, changed: false };
      if (s !== 'awaiting_approval') return { ok: false, reason: 'invalid_transition', status: s };
      if (run.approvalId) await decideApproval(orgId, run.approvalId, 'approved', userId);
      await resumeJob(run);
      return { ok: true, run: await transition(run, 'running', userId, 'approved'), changed: true };
  }
}
