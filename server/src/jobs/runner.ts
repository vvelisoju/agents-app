// EWS-10/12/23 — the runner. Each pass claims due jobs, dispatches to the registered handler,
// and applies the returned StepResult to the Job and (if any) its WorkflowRun, appending a
// WorkflowStepLog row for durable history. The StepResult union is switched exhaustively.
//
// Transitions:
//   complete      → job completed; run (if any) completed + finishedAt
//   retry{afterMs} → attempts++, exponential backoff reschedule; dead at maxAttempts
//   sleep{until}  → job re-scheduled to `until` (attempts unchanged); run → 'sleeping'
//   awaitApproval → park: run → 'awaiting_approval' + linked Approval row; nothing sent
//   fail{error}   → immediate dead-letter; run → 'failed'
// A thrown handler is treated as retry (so a transient fault backs off instead of dying).
// An unknown handler name is dead-lettered (never crashes the loop).
import type { Job, WorkflowRun } from '@prisma/client';
import prisma from '../lib/prisma';
import { log } from '../lib/log';
import { getWorkflow } from '../workflow/registry';
import type { StepResult, StepContext } from '../workflow/types';
import { emit } from '../events/emit';
import { createApproval } from '../policy/approvals';
import { safeJson } from '../lib/spineEnv';

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_CAP_MS = 5 * 60_000;

export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts));
}

function parse(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

/** Claim-and-run one pass. Returns how many jobs were claimed and how many completed. */
export async function runOnce(opts: { limit?: number; leaseMs?: number } = {}): Promise<{ claimed: number; completed: number }> {
  const { claimJobs } = await import('./claim'); // late import keeps claim's dialect check lazy
  const jobs = await claimJobs(opts.limit ?? 10, opts.leaseMs ?? 30_000);
  let completed = 0;
  for (const job of jobs) {
    if (await runJob(job)) completed++;
  }
  return { claimed: jobs.length, completed };
}

async function runJob(job: Job): Promise<boolean> {
  const handler = getWorkflow(job.handlerName);
  const run = job.workflowRunId ? await prisma.workflowRun.findUnique({ where: { id: job.workflowRunId } }) : null;

  if (!handler) {
    await deadLetter(job, run, `unknown handler: ${job.handlerName}`);
    return false;
  }

  const state = { ...parse(job.stateJson), ...(run ? parse(run.stateJson) : {}) };
  let patch: Record<string, unknown> = {};
  const steps: Array<{ message: string; detail?: Record<string, unknown> }> = [];

  const ctx: StepContext = {
    orgId: job.orgId,
    agentId: run?.agentId ?? null,
    job,
    run,
    state,
    setState: (p) => { patch = { ...patch, ...p }; },
    emit: (type, data) => emit({ orgId: job.orgId, source: 'workflow', type, data }),
    log: (message, detail) => { steps.push({ message, detail }); },
  };

  let result: StepResult;
  try {
    result = await handler(ctx);
  } catch (e: any) {
    result = { kind: 'retry', afterMs: backoffMs(job.attempts), reason: String(e?.message || e) };
  }

  for (const s of steps) await appendStep(run, s.message, 'log', s.detail);
  await applyResult(job, run, result, patch);
  return result.kind === 'complete';
}

async function applyResult(job: Job, run: WorkflowRun | null, result: StepResult, patch: Record<string, unknown>): Promise<void> {
  const nextState = safeJson({ ...parse(job.stateJson), ...patch });
  const runState = run ? safeJson({ ...parse(run.stateJson), ...patch }) : undefined;

  switch (result.kind) {
    case 'complete':
      await prisma.job.update({ where: { id: job.id }, data: { status: 'completed', lease: null, leaseUntil: null, stateJson: nextState, lastError: null } });
      if (run) await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'completed', finishedAt: new Date(), stateJson: runState! } });
      await appendStep(run, 'done', 'complete', result.output);
      break;

    case 'sleep':
      await prisma.job.update({ where: { id: job.id }, data: { status: 'pending', nextRunAt: result.until, lease: null, leaseUntil: null, stateJson: nextState } });
      if (run) await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'sleeping', stateJson: runState! } });
      await appendStep(run, `sleeping until ${result.until.toISOString()}`, 'sleep', { reason: result.reason });
      break;

    case 'retry': {
      const attempts = job.attempts + 1;
      if (attempts >= job.maxAttempts) {
        await deadLetter(job, run, result.reason || 'max attempts reached', attempts);
      } else {
        await prisma.job.update({
          where: { id: job.id },
          data: { status: 'pending', attempts, nextRunAt: new Date(Date.now() + result.afterMs), lease: null, leaseUntil: null, stateJson: nextState, lastError: result.reason ?? null },
        });
        await appendStep(run, `retry #${attempts} in ${result.afterMs}ms`, 'retry', { reason: result.reason });
      }
      break;
    }

    case 'awaitApproval': {
      // EWS-23 — park the run and create an Approval; the resume path (approve control)
      // re-enqueues a job for this run. Nothing privileged runs until approved.
      const approval = await createApproval({
        orgId: job.orgId,
        actionType: result.actionType,
        agentId: run?.agentId ?? null,
        payload: result.payload,
        requestedBy: null,
      });
      await prisma.job.update({ where: { id: job.id }, data: { status: 'completed', lease: null, leaseUntil: null, stateJson: nextState } });
      if (run) await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'awaiting_approval', approvalId: approval.id, stateJson: runState! } });
      await appendStep(run, 'waiting for your OK', 'awaitApproval', { approvalId: approval.id, actionType: result.actionType });
      break;
    }

    case 'fail':
      await deadLetter(job, run, result.error, job.attempts);
      break;
  }
}

async function deadLetter(job: Job, run: WorkflowRun | null, error: string, attempts?: number): Promise<void> {
  await prisma.job.update({
    where: { id: job.id },
    data: { status: 'dead', lease: null, leaseUntil: null, lastError: error.slice(0, 500), ...(attempts != null ? { attempts } : {}) },
  });
  if (run) await prisma.workflowRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date() } });
  await appendStep(run, 'failed', 'fail', { error: error.slice(0, 500) });
  log.warn('job dead-lettered', { jobId: job.id, handler: job.handlerName, error: error.slice(0, 200) });
}

async function appendStep(run: WorkflowRun | null, stepName: string, result: string, detail?: Record<string, unknown>): Promise<void> {
  if (!run) return;
  try {
    await prisma.workflowStepLog.create({ data: { runId: run.id, stepName, result, detailJson: safeJson(detail) } });
  } catch (e: any) {
    log.warn('step log failed', { runId: run.id, error: String(e?.message || e) });
  }
}
