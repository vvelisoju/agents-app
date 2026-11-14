// SCN-40/11/18 — outbound connection management + approval-gated campaign start + ledger
// progress. A connection stores its Trackly/source token encrypted and cannot be activated
// without a persisted risk acknowledgement. Starting a campaign creates a WorkflowRun parked at
// awaiting_approval plus a bulk_send Approval — nothing sends until the owner approves (reusing
// the EWS-19 approve → resume path). Progress is aggregated from the send ledger.
import { randomUUID } from 'node:crypto';
import prisma from '../../lib/prisma';
import { encryptSecret } from '../../lib/crypto';
import { createApproval } from '../../policy/approvals';
import { normalizePhone } from '../../lib/phone';

export interface ConnectionInput {
  orgId: string;
  agentId: string;
  dailyCap?: number;
  windowStart?: number;
  windowEnd?: number;
  minGapSec?: number;
  maxGapSec?: number;
  token?: string;
  acceptRisk?: boolean;
}

// One connection per agent (upsert). active stays false until a risk acknowledgement exists.
export async function upsertConnection(input: ConnectionInput) {
  const existing = await prisma.outboundConnection.findFirst({ where: { orgId: input.orgId, agentId: input.agentId } });
  const data: any = {
    ...(input.dailyCap != null ? { dailyCap: Math.max(1, Math.min(1000, input.dailyCap)) } : {}),
    ...(input.windowStart != null ? { windowStart: clampHour(input.windowStart) } : {}),
    ...(input.windowEnd != null ? { windowEnd: clampHour(input.windowEnd) } : {}),
    ...(input.minGapSec != null ? { minGapSec: Math.max(30, input.minGapSec) } : {}),
    ...(input.maxGapSec != null ? { maxGapSec: Math.max(30, input.maxGapSec) } : {}),
    ...(input.token ? { tokenEnc: encryptSecret(input.token) } : {}),
    ...(input.acceptRisk ? { riskAckAt: new Date() } : {}),
  };
  if (existing) return prisma.outboundConnection.update({ where: { id: existing.id }, data });
  return prisma.outboundConnection.create({ data: { orgId: input.orgId, agentId: input.agentId, ...data } });
}

export async function getConnection(orgId: string, agentId: string) {
  const c = await prisma.outboundConnection.findFirst({ where: { orgId, agentId } });
  if (!c) return null;
  // Never expose the token; surface only whether one is set.
  const { tokenEnc, ...rest } = c;
  return { ...rest, hasToken: !!tokenEnc };
}

export async function setActive(orgId: string, agentId: string, active: boolean): Promise<{ ok: boolean; reason?: string }> {
  const c = await prisma.outboundConnection.findFirst({ where: { orgId, agentId } });
  if (!c) return { ok: false, reason: 'no_connection' };
  if (active && !c.riskAckAt) return { ok: false, reason: 'risk_ack_required' };
  await prisma.outboundConnection.update({ where: { id: c.id }, data: { active } });
  return { ok: true };
}

export interface StartCampaignInput {
  orgId: string;
  agentId: string;
  requestedBy: string;
  promo: string;
  recipients: Array<{ phone: string; name?: string }>;
}

export interface StartResult {
  ok: boolean;
  runId?: string;
  approvalId?: string;
  campaignId?: string;
  recipients?: number;
  reason?: 'no_connection' | 'inactive' | 'no_recipients' | 'no_promo';
}

export async function startCampaign(input: StartCampaignInput): Promise<StartResult> {
  const conn = await prisma.outboundConnection.findFirst({ where: { orgId: input.orgId, agentId: input.agentId } });
  if (!conn) return { ok: false, reason: 'no_connection' };
  if (!conn.active || !conn.riskAckAt) return { ok: false, reason: 'inactive' };
  if (!input.promo?.trim()) return { ok: false, reason: 'no_promo' };

  // Normalize + dedupe recipients up front.
  const seen = new Set<string>();
  const recipients = input.recipients
    .map((r) => ({ phone: normalizePhone(r.phone) || '', name: r.name }))
    .filter((r) => r.phone && !seen.has(r.phone) && seen.add(r.phone));
  if (!recipients.length) return { ok: false, reason: 'no_recipients' };

  const campaignId = randomUUID();
  const run = await prisma.workflowRun.create({
    data: {
      orgId: input.orgId,
      agentId: input.agentId,
      workflowName: 'outbound-drip',
      status: 'awaiting_approval',
      stateJson: JSON.stringify({ connectionId: conn.id, campaignId, promo: input.promo.trim(), recipients, cursor: 0 }),
    },
  });
  // SCN-11 — bulk_send approval; sends nothing until approved.
  const approval = await createApproval({
    orgId: input.orgId,
    actionType: 'bulk_send',
    agentId: input.agentId,
    requestedBy: input.requestedBy,
    payload: { campaignId, recipients: recipients.length },
  });
  await prisma.workflowRun.update({ where: { id: run.id }, data: { approvalId: approval.id } });

  return { ok: true, runId: run.id, approvalId: approval.id, campaignId, recipients: recipients.length };
}

// Live progress for a campaign, aggregated from the send ledger + the run state.
export async function campaignProgress(orgId: string, runId: string) {
  const run = await prisma.workflowRun.findFirst({ where: { id: runId, orgId } });
  if (!run) return null;
  const state = safeParse(run.stateJson);
  const campaignId = (state.campaignId as string) || '';
  const total = Array.isArray(state.recipients) ? state.recipients.length : 0;

  const rows = await prisma.outboundSendLog.groupBy({
    by: ['status'],
    where: { orgId, campaignId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = { sent: 0, delivered: 0, read: 0, failed: 0, opted_out: 0 };
  for (const r of rows) counts[r.status] = r._count._all;

  return { runId: run.id, status: run.status, total, counts, startedAt: run.startedAt, finishedAt: run.finishedAt };
}

export function listOptOuts(orgId: string, agentId: string) {
  return prisma.outboundOptOut.findMany({ where: { orgId, agentId }, orderBy: { createdAt: 'desc' }, take: 500 });
}

export async function removeOptOut(orgId: string, agentId: string, phone: string): Promise<boolean> {
  const row = await prisma.outboundOptOut.findFirst({ where: { orgId, agentId, phone } });
  if (!row) return false;
  await prisma.outboundOptOut.delete({ where: { id: row.id } });
  return true;
}

function clampHour(h: number): number {
  return Math.max(0, Math.min(23, Math.round(h)));
}
function safeParse(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}
