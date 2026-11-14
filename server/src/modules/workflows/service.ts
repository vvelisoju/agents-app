// EWS-18/19 — workflow run reads + idempotent control transitions. Pause stops further steps;
// cancel is terminal; resume/approve re-enqueue a Job so the runner continues the parked run.
// Approve additionally decides the linked Approval server-side (re-authorization) — no
// model-emitted token ever resumes a gated run. Every control is idempotent and audited.
import type { WorkflowRun } from '@prisma/client';
import prisma from '../../lib/prisma';
import { audit } from '../../lib/audit';
import { enqueueJob } from '../../jobs/enqueue';
import { decideApproval } from '../../policy/approvals';

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
