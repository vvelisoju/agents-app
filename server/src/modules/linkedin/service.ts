// LKD-1 (Wave 1) — LinkedIn action service.
//
// An "action" is a single owner-approved operation on their LinkedIn account: post, comment/reply,
// or reshare. Lifecycle: pending_approval → approved → executing → done | failed (or → cancelled).
// Writes are NEVER executed on creation; the owner approves, then the browser worker claims and runs
// them. This mirrors the platform's approval-gated write discipline. See docs/LINKEDIN_AGENT_PLAN.md.
import prisma from '../../lib/prisma';

export const LINKEDIN_KINDS = ['post', 'comment', 'reshare'] as const;
export type LinkedInKind = (typeof LINKEDIN_KINDS)[number];

export const STATUS = {
  pending: 'pending_approval',
  approved: 'approved',
  executing: 'executing',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

const MAX_TEXT = 3000; // LinkedIn's post/comment limit is ~3000 chars

function err(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function isLinkedInUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https:\/\/(www\.)?linkedin\.com\//i.test(u.trim());
}

// Validate + normalise the per-kind payload. Returns the canonical payload object or throws 400.
export function normalizePayload(kind: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (!LINKEDIN_KINDS.includes(kind as LinkedInKind)) throw err('kind must be post, comment or reshare');
  if (kind === 'post') {
    const text = String(raw?.text ?? '').trim();
    if (!text) throw err('post text is required');
    if (text.length > MAX_TEXT) throw err(`post text exceeds ${MAX_TEXT} characters`);
    return { text };
  }
  if (kind === 'comment') {
    const text = String(raw?.text ?? '').trim();
    if (!text) throw err('comment text is required');
    if (text.length > MAX_TEXT) throw err(`comment text exceeds ${MAX_TEXT} characters`);
    if (!isLinkedInUrl(raw?.postUrl)) throw err('a valid linkedin.com postUrl is required');
    return { postUrl: String(raw.postUrl).trim(), text };
  }
  // reshare
  if (!isLinkedInUrl(raw?.postUrl)) throw err('a valid linkedin.com postUrl is required');
  const caption = raw?.caption != null ? String(raw.caption).trim() : '';
  if (caption.length > MAX_TEXT) throw err(`caption exceeds ${MAX_TEXT} characters`);
  return caption ? { postUrl: String(raw.postUrl).trim(), caption } : { postUrl: String(raw.postUrl).trim() };
}

function shape(a: any) {
  let payload: unknown = {};
  let result: unknown = null;
  try { payload = JSON.parse(a.payloadJson); } catch { /* ignore */ }
  try { result = a.resultJson ? JSON.parse(a.resultJson) : null; } catch { /* ignore */ }
  return {
    id: a.id, agentId: a.agentId, kind: a.kind, status: a.status,
    payload, result, error: a.error,
    approvedAt: a.approvedAt, executedAt: a.executedAt, createdAt: a.createdAt,
  };
}

async function ownedAgent(orgId: string, agentId: string) {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, orgId }, select: { id: true } });
  if (!agent) throw err('agent not found', 404);
  return agent;
}

export async function createAction(orgId: string, agentId: string, kind: string, rawPayload: Record<string, unknown>) {
  await ownedAgent(orgId, agentId);
  const payload = normalizePayload(kind, rawPayload);
  const a = await prisma.linkedInAction.create({
    data: { orgId, agentId, kind, status: STATUS.pending, payloadJson: JSON.stringify(payload) },
  });
  return shape(a);
}

export async function listActions(orgId: string, agentId: string) {
  const rows = await prisma.linkedInAction.findMany({ where: { orgId, agentId }, orderBy: { createdAt: 'desc' }, take: 100 });
  return rows.map(shape);
}

export async function approveAction(orgId: string, actionId: string) {
  const a = await prisma.linkedInAction.findFirst({ where: { id: actionId, orgId } });
  if (!a) throw err('action not found', 404);
  if (a.status !== STATUS.pending) throw err(`action is ${a.status}, not pending approval`, 409);
  const updated = await prisma.linkedInAction.update({ where: { id: a.id }, data: { status: STATUS.approved, approvedAt: new Date() } });
  return shape(updated);
}

export async function cancelAction(orgId: string, actionId: string) {
  const a = await prisma.linkedInAction.findFirst({ where: { id: actionId, orgId } });
  if (!a) throw err('action not found', 404);
  if (a.status !== STATUS.pending && a.status !== STATUS.approved) throw err(`action is ${a.status} and can no longer be cancelled`, 409);
  const updated = await prisma.linkedInAction.update({ where: { id: a.id }, data: { status: STATUS.cancelled } });
  return shape(updated);
}

// ── Worker side ──
// Claim the oldest approved action for execution. The status-guarded updateMany makes the claim
// atomic enough that two overlapping worker ticks can't run the same action twice.
export async function claimNextApproved() {
  const next = await prisma.linkedInAction.findFirst({ where: { status: STATUS.approved }, orderBy: { approvedAt: 'asc' } });
  if (!next) return null;
  const claimed = await prisma.linkedInAction.updateMany({ where: { id: next.id, status: STATUS.approved }, data: { status: STATUS.executing } });
  if (claimed.count === 0) return null; // another tick claimed it first
  return prisma.linkedInAction.findUnique({ where: { id: next.id } });
}

export async function recordResult(actionId: string, ok: boolean, data: Record<string, unknown>) {
  await prisma.linkedInAction.update({
    where: { id: actionId },
    data: {
      status: ok ? STATUS.done : STATUS.failed,
      resultJson: ok ? JSON.stringify(data) : null,
      error: ok ? null : String((data as any)?.error ?? 'failed'),
      executedAt: new Date(),
    },
  });
}
