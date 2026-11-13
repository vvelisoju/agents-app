// Leads & light CRM (B18). Every conversation is a lead; this aggregates them
// across all the org's agents with a status + notes, and exports CSV.
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';

const router = Router();
const orgOf = (req: any) => req.user.orgId;

router.get('/', asyncHandler(async (req, res) => {
  const convs = await prisma.conversation.findMany({
    where: { orgId: orgOf(req) },
    orderBy: { lastMessageAt: 'desc' },
    include: { agent: { select: { name: true, channelType: true } } },
  });
  res.json(convs.map((c) => ({
    id: c.id, agentId: c.agentId, contactName: c.contactName, contactNumber: c.contactNumber,
    leadStatus: c.leadStatus, leadNotes: c.leadNotes, lastMessageAt: c.lastMessageAt,
    agentName: c.agent?.name, channelType: c.agent?.channelType,
  })));
}));

router.get('/export', asyncHandler(async (req, res) => {
  const convs = await prisma.conversation.findMany({
    where: { orgId: orgOf(req) }, orderBy: { lastMessageAt: 'desc' },
    include: { agent: { select: { name: true } } },
  });
  const rows: string[][] = [['Name', 'Contact', 'Agent', 'Status', 'Last message', 'Notes']];
  for (const c of convs) {
    rows.push([c.contactName || '', c.contactNumber.replace(/^web:/, ''), c.agent?.name || '', c.leadStatus,
      new Date(c.lastMessageAt).toISOString(), (c.leadNotes || '').replace(/\n/g, ' ')]);
  }
  const csv = rows.map((r) => r.map((f) => '"' + String(f).replace(/"/g, '""') + '"').join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
  res.send(csv);
}));

router.patch('/:cid', asyncHandler(async (req, res) => {
  const conv = await prisma.conversation.findUnique({ where: { id: String(req.params.cid) } });
  if (!conv || conv.orgId !== orgOf(req)) return res.status(404).json({ error: 'not found' });
  const data: any = {};
  if (typeof req.body?.leadStatus === 'string') data.leadStatus = req.body.leadStatus;
  if (typeof req.body?.leadNotes === 'string') data.leadNotes = req.body.leadNotes;
  await prisma.conversation.update({ where: { id: conv.id }, data });
  res.json({ ok: true });
}));

export default router;
