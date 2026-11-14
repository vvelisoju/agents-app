// EWS-33 / OBS-18 / POL-17 — retention + TTL sweeps, all registered on the shared maintenance
// ticker (EWS-34). Idempotent and bounded by a configurable window (RETENTION_DAYS, default 90).
// They prune only terminal/processed/expired rows and never touch in-flight runs, unprocessed
// outbox events, or inbox Message history. Importing this module registers the sweeps.
import prisma from './prisma';
import { registerMaintenanceSweep } from './maintenance';

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS) || 90;
const APPROVAL_PRUNE_DAYS = Number(process.env.APPROVAL_RETENTION_DAYS) || 180;

function cutoff(days = RETENTION_DAYS): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// EWS-33 — processed outbox events past the window.
registerMaintenanceSweep('prune-domain-events', async () => {
  const { count } = await prisma.domainEvent.deleteMany({ where: { processedAt: { not: null, lt: cutoff() } } });
  return { domainEvents: count };
});

// EWS-33 — terminal jobs (completed/dead) past the window. Pending/leased/running are untouched.
registerMaintenanceSweep('prune-jobs', async () => {
  const { count } = await prisma.job.deleteMany({ where: { status: { in: ['completed', 'dead'] }, createdAt: { lt: cutoff() } } });
  return { jobs: count };
});

// EWS-33 — terminal workflow runs past the window; their WorkflowStepLog rows cascade-delete.
// In-flight runs (running/sleeping/awaiting_approval/paused) are left intact.
registerMaintenanceSweep('prune-workflow-runs', async () => {
  const { count } = await prisma.workflowRun.deleteMany({
    where: { status: { in: ['completed', 'failed', 'canceled'] }, finishedAt: { not: null, lt: cutoff() } },
  });
  return { workflowRuns: count };
});

// OBS-18 — execution trace (UsageEvent) + per-tool-call step rows past the window. Metrics over
// the retained window are unaffected.
registerMaintenanceSweep('prune-traces', async () => {
  const ue = await prisma.usageEvent.deleteMany({ where: { createdAt: { lt: cutoff() } } });
  const es = await prisma.executionStep.deleteMany({ where: { createdAt: { lt: cutoff() } } });
  return { usageEvents: ue.count, executionSteps: es.count };
});

// POL-17 — expire stale pending approvals (past expiresAt → 'expired', can no longer execute) and
// prune old audit rows beyond a longer retention window.
registerMaintenanceSweep('expire-and-prune-approvals', async () => {
  const expired = await prisma.approval.updateMany({
    where: { status: 'pending', expiresAt: { not: null, lt: new Date() } },
    data: { status: 'expired' },
  });
  const audit = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff(APPROVAL_PRUNE_DAYS) } } });
  return { approvalsExpired: expired.count, auditPruned: audit.count };
});

// EWS-33 — terminal outbound send-ledger rows past the window (the highest-volume outbound table).
registerMaintenanceSweep('prune-outbound-ledger', async () => {
  const { count } = await prisma.outboundSendLog.deleteMany({ where: { createdAt: { lt: cutoff() } } });
  return { outboundSendLog: count };
});
