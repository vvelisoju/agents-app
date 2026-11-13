import { Router } from 'express';
import prisma from '../../lib/prisma';
import { asyncHandler } from '../../middleware/asyncHandler';
import { requireAgent } from '../../middleware/auth';
import { getAdapter } from '../../channels/registry';
import * as realtime from '../../lib/realtime';
import { draftFor } from '../../engine/engine';
import { learnFromUrl } from '../../lib/learn';
import { trainingSummary, Source } from '../../lib/training';
import { getTemplate } from '../../lib/templates';
import { validate } from '../../middleware/validate';
import { createAgentSchema, sourceSchema } from '../../lib/schemas';
import { normalizePhone, toWhatsappDigits } from '../../lib/phone';

const router = Router();

// ---- collection ----
router.get('/', asyncHandler(async (req, res) => {
  const agents = await prisma.agent.findMany({ where: { orgId: (req as any).user.orgId }, orderBy: { createdAt: 'asc' } });
  res.json(agents);
}));

router.post('/', validate(createAgentSchema), asyncHandler(async (req, res) => {
  const orgId = (req as any).user.orgId;
  const name = req.body.name;
  const sub = await prisma.subscription.findUnique({ where: { orgId } });
  const count = await prisma.agent.count({ where: { orgId } });
  if (sub && count >= sub.maxAgents) {
    return res.status(402).json({ error: `Plan limit reached (${sub.maxAgents} agents). Upgrade to add more.`, code: 'subscription_required' });
  }
  const agent = await prisma.agent.create({ data: { orgId, name, channelType: req.body?.channelType || 'whatsapp-web' } });
  await prisma.trainingProfile.create({ data: { agentId: agent.id } });
  res.json(agent);
}));

// ---- agent-scoped (requireAgent sets req.agent) ----
const scoped = Router({ mergeParams: true });
scoped.use(requireAgent);

const agent = (req: any) => req.agent;

async function loadSources(agentId: string): Promise<Source[]> {
  const rows = await prisma.trainingSource.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, type: r.type as any, data: JSON.parse(r.dataJson), enabled: r.enabled }));
}

scoped.get('/', asyncHandler(async (req, res) => res.json(agent(req))));

scoped.patch('/', asyncHandler(async (req, res) => {
  const data: any = {};
  if (typeof req.body?.autoSend === 'boolean') data.autoSend = req.body.autoSend;
  if (typeof req.body?.paused === 'boolean') data.paused = req.body.paused;
  if (typeof req.body?.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim();
  // Business hours (null clears; number sets). hoursStart/End are 0-23 in `timezone`.
  if (req.body?.awayMessage === null || typeof req.body?.awayMessage === 'string') data.awayMessage = req.body.awayMessage;
  if (req.body?.hoursStart === null || typeof req.body?.hoursStart === 'number') data.hoursStart = req.body.hoursStart;
  if (req.body?.hoursEnd === null || typeof req.body?.hoursEnd === 'number') data.hoursEnd = req.body.hoursEnd;
  if (typeof req.body?.timezone === 'string') data.timezone = req.body.timezone;
  if (req.body?.channelConfig && typeof req.body.channelConfig === 'object') data.channelConfig = JSON.stringify(req.body.channelConfig);
  // Owner-alert number (null/empty clears). Validate as an Indian mobile.
  if (req.body?.alertNumber === null || req.body?.alertNumber === '') data.alertNumber = null;
  else if (typeof req.body?.alertNumber === 'string') {
    const norm = normalizePhone(req.body.alertNumber);
    if (!norm) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number for alerts.' });
    data.alertNumber = norm;
  }
  // Owner-defined alert condition (free text). null/empty clears → default is used.
  if (req.body?.alertCondition === null || req.body?.alertCondition === '') data.alertCondition = null;
  else if (typeof req.body?.alertCondition === 'string') data.alertCondition = req.body.alertCondition.trim().slice(0, 600);
  const updated = await prisma.agent.update({ where: { id: agent(req).id }, data });
  res.json(updated);
}));

scoped.delete('/', asyncHandler(async (req, res) => {
  const adapter = getAdapter(agent(req).channelType);
  if (adapter?.stop) await adapter.stop(agent(req).id).catch(() => {});
  await prisma.agent.delete({ where: { id: agent(req).id } });
  res.json({ ok: true });
}));

scoped.post('/connect', asyncHandler(async (req, res) => {
  const a = agent(req);
  const adapter = getAdapter(a.channelType);
  if (adapter?.start) { await adapter.start(a.id); return res.json({ ok: true, status: 'connecting' }); }
  // Channels without a session (e.g. website widget) are "connected" once enabled.
  await prisma.agent.update({ where: { id: a.id }, data: { status: 'connected' } });
  realtime.emit(a.id, 'status', { status: 'connected' });
  res.json({ ok: true, status: 'connected' });
}));

scoped.post('/disconnect', asyncHandler(async (req, res) => {
  const a = agent(req);
  const adapter = getAdapter(a.channelType);
  if (adapter?.stop) await adapter.stop(a.id);
  else { await prisma.agent.update({ where: { id: a.id }, data: { status: 'disconnected' } }); realtime.emit(a.id, 'status', { status: 'disconnected' }); }
  res.json({ ok: true });
}));

// ---- training ----
scoped.get('/training', asyncHandler(async (req, res) => {
  const agentId = agent(req).id;
  let profile = await prisma.trainingProfile.findUnique({ where: { agentId } });
  if (!profile) profile = await prisma.trainingProfile.create({ data: { agentId } });
  const sources = await loadSources(agentId);
  res.json({ profile, sources, summary: trainingSummary(profile, sources) });
}));

scoped.put('/training/profile', asyncHandler(async (req, res) => {
  const agentId = agent(req).id;
  const b = req.body || {};
  const profile = await prisma.trainingProfile.upsert({
    where: { agentId },
    update: {
      instructions: b.instructions ?? '', restrictions: b.restrictions ?? '',
      tone: b.tone ?? 'warm, concise, helpful', language: b.language ?? 'match the customer',
      escalationKeyword: b.escalationKeyword || 'NEEDS_HUMAN',
    },
    create: { agentId, instructions: b.instructions ?? '', restrictions: b.restrictions ?? '' },
  });
  res.json(profile);
}));

// Apply a vertical template → pre-fills the agent's persona in one tap.
scoped.post('/training/apply-template', asyncHandler(async (req, res) => {
  const t = getTemplate(String(req.body?.templateId));
  if (!t) return res.status(400).json({ error: 'unknown template' });
  const profile = await prisma.trainingProfile.upsert({
    where: { agentId: agent(req).id },
    update: { instructions: t.instructions, tone: t.tone, language: t.language, restrictions: t.restrictions },
    create: { agentId: agent(req).id, instructions: t.instructions, tone: t.tone, language: t.language, restrictions: t.restrictions },
  });
  res.json(profile);
}));

// Train from a link → confirmable draft (nothing saved here).
scoped.post('/training/learn', asyncHandler(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Paste a link to learn from.' });
  try {
    res.json(await learnFromUrl(agent(req).name, url));
  } catch (e: any) {
    res.status(422).json({ error: e?.message || 'Could not learn from that link.' });
  }
}));

scoped.post('/training/sources', validate(sourceSchema), asyncHandler(async (req, res) => {
  const { type, data } = req.body;
  const row = await prisma.trainingSource.create({ data: { agentId: agent(req).id, type, dataJson: JSON.stringify(data || {}) } });
  res.json({ id: row.id });
}));

scoped.patch('/training/sources/:sid', asyncHandler(async (req, res) => {
  const row = await prisma.trainingSource.findUnique({ where: { id: String(req.params.sid) } });
  if (!row || row.agentId !== agent(req).id) return res.status(404).json({ error: 'source not found' });
  const data: any = {};
  if (req.body?.data) data.dataJson = JSON.stringify(req.body.data);
  if (typeof req.body?.enabled === 'boolean') data.enabled = req.body.enabled;
  await prisma.trainingSource.update({ where: { id: row.id }, data });
  res.json({ ok: true });
}));

scoped.delete('/training/sources/:sid', asyncHandler(async (req, res) => {
  const row = await prisma.trainingSource.findUnique({ where: { id: String(req.params.sid) } });
  if (!row || row.agentId !== agent(req).id) return res.status(404).json({ error: 'source not found' });
  await prisma.trainingSource.delete({ where: { id: row.id } });
  res.json({ ok: true });
}));

// Test Console
scoped.post('/test', asyncHandler(async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const { draft, urgentReason } = await draftFor(agent(req), message);
    res.json({ draft, urgentReason });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
}));

// ---- conversations ----
scoped.get('/conversations', asyncHandler(async (req, res) => {
  res.json(await prisma.conversation.findMany({ where: { agentId: agent(req).id }, orderBy: { lastMessageAt: 'desc' } }));
}));

scoped.get('/conversations/:cid/messages', asyncHandler(async (req, res) => {
  const conv = await prisma.conversation.findUnique({ where: { id: String(req.params.cid) } });
  if (!conv || conv.agentId !== agent(req).id) return res.status(404).json({ error: 'conversation not found' });
  res.json(await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'asc' } }));
}));

// Human takeover / mute toggles for one conversation.
scoped.patch('/conversations/:cid', asyncHandler(async (req, res) => {
  const conv = await prisma.conversation.findUnique({ where: { id: String(req.params.cid) } });
  if (!conv || conv.agentId !== agent(req).id) return res.status(404).json({ error: 'conversation not found' });
  const data: any = {};
  if (typeof req.body?.takenOver === 'boolean') data.takenOver = req.body.takenOver;
  if (typeof req.body?.muted === 'boolean') data.muted = req.body.muted;
  await prisma.conversation.update({ where: { id: conv.id }, data });
  res.json({ ok: true });
}));

// Owner sends a manual reply (human takeover).
scoped.post('/conversations/:cid/reply', asyncHandler(async (req, res) => {
  const conv = await prisma.conversation.findUnique({ where: { id: String(req.params.cid) } });
  if (!conv || conv.agentId !== agent(req).id) return res.status(404).json({ error: 'conversation not found' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text required' });
  const adapter = getAdapter(agent(req).channelType);
  try { if (adapter) await adapter.send(agent(req).id, conv.contactNumber, text); }
  catch (e: any) { return res.status(500).json({ error: e?.message || 'send failed' }); }
  await prisma.message.create({ data: { conversationId: conv.id, agentId: agent(req).id, direction: 'outbound', body: text, status: 'sent' } });
  res.json({ ok: true });
}));

scoped.post('/messages/:mid/approve', asyncHandler(async (req, res) => {
  const msg = await prisma.message.findUnique({ where: { id: String(req.params.mid) } });
  if (!msg || msg.agentId !== agent(req).id) return res.status(404).json({ error: 'message not found' });
  const conv = await prisma.conversation.findUnique({ where: { id: msg.conversationId } });
  try {
    const adapter = getAdapter(agent(req).channelType);
    if (adapter) await adapter.send(agent(req).id, conv!.contactNumber, msg.body);
    await prisma.message.update({ where: { id: msg.id }, data: { status: 'sent' } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'send failed' });
  }
}));

scoped.post('/messages/:mid/skip', asyncHandler(async (req, res) => {
  const msg = await prisma.message.findUnique({ where: { id: String(req.params.mid) } });
  if (!msg || msg.agentId !== agent(req).id) return res.status(404).json({ error: 'message not found' });
  await prisma.message.update({ where: { id: msg.id }, data: { status: 'skipped' } });
  res.json({ ok: true });
}));

// --- TEMPORARY: promo send smoke test (Trackly → WhatsApp proof) --------------
// Owner-only, org-scoped (requireAgent). Disabled unless TEST_SEND_ENABLED=true.
// Body: { to: "<10-digit>", text?: string, mediaUrl?: string }. Remove after testing.
scoped.post('/test-send', asyncHandler(async (req, res) => {
  if (process.env.TEST_SEND_ENABLED !== 'true') return res.status(403).json({ error: 'test-send disabled' });
  const a = agent(req);
  if (a.channelType !== 'whatsapp-web') return res.status(400).json({ error: 'not a whatsapp-web agent' });
  const to10 = normalizePhone(String(req.body?.to || ''));
  if (!to10) return res.status(400).json({ error: 'valid Indian mobile required in `to`' });
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const mediaUrl = typeof req.body?.mediaUrl === 'string' ? req.body.mediaUrl.trim() : '';
  if (!text && !mediaUrl) return res.status(400).json({ error: 'text or mediaUrl required' });
  const wa = require('../../channels/whatsapp');
  let chatId: string | null;
  try { chatId = await wa.resolveNumber(a.id, toWhatsappDigits(to10)); }
  catch (e: any) { return res.status(409).json({ error: e?.message || 'session not connected' }); }
  if (!chatId) return res.status(422).json({ error: 'number is not on WhatsApp' });
  try {
    const messageId = mediaUrl
      ? await wa.sendMedia(a.id, chatId, mediaUrl, text || undefined)
      : (await wa.sendText(a.id, chatId, text), 'sent');
    res.json({ ok: true, to: to10, messageId });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'send failed' });
  }
}));

router.use('/:id', scoped);

export default router;
