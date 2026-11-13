// Public, unauthenticated endpoints for the embeddable website chat widget.
// Scoped by the agent's uuid (acts as a public widget key).
import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { processInbound } from '../../engine/engine';

const router = Router();

async function websiteAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  return agent && agent.channelType === 'website' ? agent : null;
}

// Visitor sends a message.
router.post('/widget/:agentId/message', asyncHandler(async (req, res) => {
  const agent = await websiteAgent(String(req.params.agentId));
  if (!agent) return res.status(404).json({ error: 'not found' });
  const { contactId, name, text } = req.body || {};
  if (!contactId || !String(text || '').trim()) return res.status(400).json({ error: 'contactId and text required' });
  const result = await processInbound(agent.id, { from: 'web:' + contactId, contactName: name || 'Website visitor', text: String(text) });
  // Return the reply if it was sent (auto mode) or an away message; drafts wait for approval.
  const show = result.status === 'sent' || result.status === 'away';
  res.json({ status: result.status, reply: show ? result.reply : null });
}));

// Visitor polls for new replies (auto-send replies + approved drafts).
router.get('/widget/:agentId/messages', asyncHandler(async (req, res) => {
  const agent = await websiteAgent(String(req.params.agentId));
  if (!agent) return res.status(404).json({ error: 'not found' });
  const contactId = String(req.query.contactId || '');
  if (!contactId) return res.status(400).json({ error: 'contactId required' });
  const conv = await prisma.conversation.findUnique({ where: { agentId_contactNumber: { agentId: agent.id, contactNumber: 'web:' + contactId } } });
  if (!conv) return res.json({ messages: [] });
  const after = req.query.after ? new Date(String(req.query.after)) : new Date(0);
  const msgs = await prisma.message.findMany({
    where: { conversationId: conv.id, direction: 'outbound', status: 'sent', createdAt: { gt: after } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ messages: msgs.map((m) => ({ id: m.id, body: m.body, at: m.createdAt })) });
}));

export default router;
