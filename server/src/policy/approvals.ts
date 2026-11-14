// POL-07 — generalized approval queue. The existing approve-before-send draft flow
// (Message.status='draft') is the first instance; bulk send / booking / delete / financial
// actions create Approval rows here. Decisions are idempotent and audited. The actual
// execution of an approved action is the consumer's job (Phase 5/6 handlers set 'executed').
import prisma from '../lib/prisma';
import { audit } from '../lib/audit';
import { fireApproved } from './approvalExecutor';
import type { Action } from './engine';

export function createApproval(input: {
  orgId: string;
  actionType: string;
  agentId?: string | null;
  payload?: Record<string, unknown>;
  requestedBy?: string | null;
  expiresInMs?: number;
}) {
  return prisma.approval.create({
    data: {
      orgId: input.orgId,
      agentId: input.agentId ?? null,
      actionType: input.actionType,
      payloadJson: JSON.stringify(input.payload ?? {}),
      requestedBy: input.requestedBy ?? null,
      expiresAt: input.expiresInMs ? new Date(Date.now() + input.expiresInMs) : null,
    },
  });
}

export function listApprovals(orgId: string, status = 'pending') {
  return prisma.approval.findMany({ where: { orgId, status }, orderBy: { createdAt: 'desc' }, take: 200 });
}

export interface DecideResult {
  ok: boolean;
  status?: string;
  reason?: 'not_found' | 'already_decided' | 'expired';
  approval?: unknown;
}

/** Approve or reject a pending approval. Idempotent: a non-pending or expired approval
 *  is never re-decided (and never executed twice). */
export async function decideApproval(
  orgId: string,
  id: string,
  decision: 'approved' | 'rejected',
  userId?: string,
): Promise<DecideResult> {
  const a = await prisma.approval.findFirst({ where: { id, orgId } });
  if (!a) return { ok: false, reason: 'not_found' };
  if (a.status !== 'pending') return { ok: false, reason: 'already_decided', status: a.status };
  if (a.expiresAt && a.expiresAt < new Date()) {
    await prisma.approval.update({ where: { id }, data: { status: 'expired' } }).catch(() => {});
    return { ok: false, reason: 'expired' };
  }
  const approval = await prisma.approval.update({
    where: { id },
    data: { status: decision, decidedByUserId: userId ?? null, decidedAt: new Date() },
  });
  audit({ orgId, actorUserId: userId, action: `approval.${decision}`, targetType: 'approval', targetId: id, metadata: { actionType: a.actionType } });
  // POL-10: on approval, run any registered executor for this action (e.g. a gated tool call).
  if (decision === 'approved') await fireApproved(approval);
  return { ok: true, status: decision, approval };
}

// Re-export for convenience at call sites that gate on the 'approve' permission.
export type { Action };
