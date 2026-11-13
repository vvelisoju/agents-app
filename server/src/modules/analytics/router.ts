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

export default router;
