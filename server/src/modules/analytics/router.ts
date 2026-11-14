// Analytics (B14.2/14.3) — "what your agents did". Org-scoped counts for the
// owner dashboard / activity feed.
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();
const org = (req: any) => req.user.orgId;

router.get('/', asyncHandler(async (req, res) => {
  const orgId = org(req);
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

  const [agents, conversations, repliesTotal, repliesToday, leadGroups] = await Promise.all([
    prisma.agent.count({ where: { orgId } }),
    prisma.conversation.count({ where: { orgId } }),
    prisma.usageEvent.count({ where: { orgId } }),
    prisma.usageEvent.count({ where: { orgId, createdAt: { gte: startOfDay } } }),
    prisma.conversation.groupBy({ by: ['leadStatus'], where: { orgId }, _count: true }),
  ]);

  const leadsByStatus: Record<string, number> = {};
  for (const g of leadGroups) leadsByStatus[g.leadStatus] = (g as any)._count;

  // Per-agent breakdown for the dashboard.
  const agentList = await prisma.agent.findMany({ where: { orgId }, select: { id: true, name: true, channelType: true } });
  const perAgent = await Promise.all(agentList.map(async (ag) => ({
    agentId: ag.id, name: ag.name, channelType: ag.channelType,
    conversations: await prisma.conversation.count({ where: { agentId: ag.id } }),
    repliesTotal: await prisma.usageEvent.count({ where: { agentId: ag.id } }),
  })));

  res.json({ agents, conversations, repliesTotal, repliesToday, leadsByStatus, perAgent });
}));

const ownerOnly = (req: any, res: any): boolean => {
  if (req.user.role !== 'owner') { res.status(403).json({ error: 'owner only', code: 'forbidden' }); return false; }
  return true;
};

// OBS-11 — recent execution traces (owner-only, filterable, paginated).
router.get('/executions', asyncHandler(async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const orgId = org(req);
  const take = Math.min(Number(req.query.limit) || 50, 200);
  const where: any = { orgId, outcome: { not: null } };
  if (req.query.agentId) where.agentId = String(req.query.agentId);
  if (req.query.outcome) where.outcome = String(req.query.outcome);
  const rows = await prisma.usageEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take });
  res.json({
    executions: rows.map((r) => ({
      id: r.id, executionId: r.executionId, agentId: r.agentId, outcome: r.outcome, model: r.model,
      inputTokens: r.inputTokens, outputTokens: r.outputTokens, costMicros: r.costMicros,
      latencyMs: r.latencyMs, approvalState: r.approvalState, at: r.createdAt,
    })),
  });
}));

// OBS-13 — eval metrics over the execution trace (owner-only). Percentiles computed in
// JS so the query is dialect-agnostic (SQLite dev / Postgres prod).
router.get('/metrics', asyncHandler(async (req, res) => {
  if (!ownerOnly(req, res)) return;
  const orgId = org(req);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 864e5);
  const rows = await prisma.usageEvent.findMany({
    where: { orgId, outcome: { not: null }, createdAt: { gte: from } },
    select: { outcome: true, costMicros: true, latencyMs: true },
  });
  const total = rows.length;
  const byOutcome: Record<string, number> = {};
  let costMicros = 0;
  const lat: number[] = [];
  for (const r of rows) {
    if (r.outcome) byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    if (r.costMicros) costMicros += r.costMicros;
    if (r.latencyMs != null) lat.push(r.latencyMs);
  }
  lat.sort((a, b) => a - b);
  const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);
  const produced = (byOutcome.sent || 0) + (byOutcome.draft || 0);
  res.json({
    total, byOutcome, costMicros,
    latencyP50: pct(50), latencyP95: pct(95),
    successRate: total ? produced / total : 0,
    interventionRate: total ? (byOutcome.needs_human || 0) / total : 0,
  });
}));

export default router;
