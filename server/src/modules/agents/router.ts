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
import { widgetKey } from '../../lib/widgetKey';
import { encryptSecret, isEncrypted } from '../../lib/crypto';
import { requirePermission } from '../../middleware/authz';
import { audit } from '../../lib/audit';
import { validateSpec, specFromAgent, applySpec } from '../../lib/agentSpec';
import { generateSpecFromNL } from '../../lib/agentBuilder';
import { canSpend } from '../../lib/budget';

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
  await prisma.trainingProfile.create({ data: { agentId: agent.id, orgId } });
  res.json(agent);
}));

// STU-7: describe an agent in words -> a VALIDATED AgentSpec draft (nothing saved).
// Budget-gated (paid model call); build-from-URL inherits the SSRF guard via learn.ts.
router.post('/build', requirePermission('agent_create'), asyncHandler(async (req, res) => {
  const orgId = (req as any).user.orgId;
  const spend = await canSpend(orgId);
  if (!spend.allowed) return res.status(429).json({ error: 'daily limit reached', code: 'budget_exceeded' });
  try {
    const out = await generateSpecFromNL(String(req.body?.description || ''), {
      url: req.body?.url ? String(req.body.url) : undefined,
      channelType: req.body?.channelType ? String(req.body.channelType) : undefined,
    });
    res.json(out);
  } catch (e: any) {
    res.status(400).json({ error: e?.friendly ? e.message : 'Could not build the agent', code: 'build_failed' });
  }
}));

// ---- agent-scoped (requireAgent sets req.agent) ----
const scoped = Router({ mergeParams: true });
scoped.use(requireAgent);

const agent = (req: any) => req.agent;
const num = (v: unknown): number | undefined => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));

async function loadSources(agentId: string): Promise<Source[]> {
  const rows = await prisma.trainingSource.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ id: r.id, type: r.type as any, data: JSON.parse(r.dataJson), enabled: r.enabled }));
}

// FND-54: the owner fetches the signed widget key so the website embed snippet can
// carry it (the public endpoints reject requests without it).
scoped.get('/widget-key', asyncHandler(async (req, res) => {
  res.json({ key: widgetKey(agent(req).id) });
}));

// EWS-18 — this agent's workflow runs (org + agent scoped).
scoped.get('/workflows', asyncHandler(async (req, res) => {
  const { listRuns } = await import('../workflows/service');
  res.json({ runs: await listRuns((req as any).user.orgId, { agentId: agent(req).id, limit: 100 }) });
}));

// SCN-42 — website-monitor watches (fetch → diff → notify on change), spine-driven.
scoped.get('/watches', asyncHandler(async (req, res) => {
  const { listWatches } = await import('../monitors/service');
  res.json({ watches: await listWatches((req as any).user.orgId, agent(req).id) });
}));

scoped.post('/watches', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const url = String(req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const { createWatch } = await import('../monitors/service');
    const watch = await createWatch({
      orgId: (req as any).user.orgId,
      agentId: agent(req).id,
      url,
      label: req.body?.label ? String(req.body.label) : undefined,
      cadence: req.body?.cadence ? String(req.body.cadence) : undefined,
      notifyNumber: req.body?.notifyNumber ? String(req.body.notifyNumber) : undefined,
    });
    audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'watch.create', targetType: 'watch', targetId: watch.id });
    res.json(watch);
  } catch (e: any) {
    res.status(400).json({ error: e?.friendly ? e.message : 'Could not add that watch', code: 'watch_failed' });
  }
}));

scoped.patch('/watches/:watchId', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { setWatchActive } = await import('../monitors/service');
  const watch = await setWatchActive((req as any).user.orgId, String(req.params.watchId), !!req.body?.active);
  if (!watch) return res.status(404).json({ error: 'not found' });
  res.json(watch);
}));

scoped.delete('/watches/:watchId', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { deleteWatch } = await import('../monitors/service');
  const ok = await deleteWatch((req as any).user.orgId, String(req.params.watchId));
  if (!ok) return res.status(404).json({ error: 'not found' });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'watch.delete', targetType: 'watch', targetId: String(req.params.watchId) });
  res.json({ ok: true });
}));

// ---- SCN-40 — outbound drip: connection, campaign start (approval-gated), progress, opt-outs ----
scoped.get('/outbound/connection', asyncHandler(async (req, res) => {
  const { getConnection } = await import('../outbound/service');
  res.json({ connection: await getConnection((req as any).user.orgId, agent(req).id) });
}));

scoped.post('/outbound/connection', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { upsertConnection } = await import('../outbound/service');
  const c = await upsertConnection({
    orgId: (req as any).user.orgId, agentId: agent(req).id,
    dailyCap: num(req.body?.dailyCap), windowStart: num(req.body?.windowStart), windowEnd: num(req.body?.windowEnd),
    minGapSec: num(req.body?.minGapSec), maxGapSec: num(req.body?.maxGapSec),
    token: req.body?.token ? String(req.body.token) : undefined,
    acceptRisk: req.body?.acceptRisk === true,
  });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'outbound.connection_upsert', targetType: 'agent', targetId: agent(req).id });
  const { tokenEnc, ...rest } = c as any;
  res.json({ connection: { ...rest, hasToken: !!tokenEnc } });
}));

scoped.post('/outbound/connection/active', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { setActive } = await import('../outbound/service');
  const r = await setActive((req as any).user.orgId, agent(req).id, req.body?.active === true);
  if (!r.ok) return res.status(r.reason === 'no_connection' ? 404 : 400).json({ error: r.reason });
  res.json({ ok: true });
}));

scoped.post('/outbound/campaigns', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { startCampaign } = await import('../outbound/service');
  const recipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [];
  const r = await startCampaign({
    orgId: (req as any).user.orgId, agentId: agent(req).id, requestedBy: (req as any).user.id,
    promo: String(req.body?.promo || ''), recipients,
  });
  if (!r.ok) return res.status(400).json({ error: r.reason });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'outbound.campaign_start', targetType: 'agent', targetId: agent(req).id, metadata: { campaignId: r.campaignId, recipients: r.recipients } });
  res.json(r);
}));

scoped.get('/outbound/campaigns/:runId', asyncHandler(async (req, res) => {
  const { campaignProgress } = await import('../outbound/service');
  const p = await campaignProgress((req as any).user.orgId, String(req.params.runId));
  if (!p) return res.status(404).json({ error: 'not found' });
  res.json(p);
}));

scoped.get('/outbound/optouts', asyncHandler(async (req, res) => {
  const { listOptOuts } = await import('../outbound/service');
  res.json({ optOuts: await listOptOuts((req as any).user.orgId, agent(req).id) });
}));

scoped.delete('/outbound/optouts/:phone', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const { removeOptOut } = await import('../outbound/service');
  const ok = await removeOptOut((req as any).user.orgId, agent(req).id, String(req.params.phone));
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
}));

// ---- SPEC-13..18 / STU — Agent Spec, versioning, lifecycle & clone ----
scoped.get('/spec', asyncHandler(async (req, res) => {
  res.json({ spec: await specFromAgent(agent(req).id) });
}));

scoped.post('/apply-spec', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const v = validateSpec(req.body?.spec);
  if (!v.ok) return res.status(400).json({ error: 'invalid spec', issues: v.errors });
  await applySpec(agent(req).id, v.spec);
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'agent.apply_spec', targetType: 'agent', targetId: agent(req).id });
  res.json({ ok: true, spec: await specFromAgent(agent(req).id) });
}));

scoped.get('/versions', asyncHandler(async (req, res) => {
  const versions = await prisma.agentVersion.findMany({
    where: { agentId: agent(req).id }, orderBy: { version: 'desc' },
    select: { id: true, version: true, note: true, status: true, createdAt: true },
  });
  res.json({ versions, currentVersionId: agent(req).currentVersionId });
}));

// Publish: snapshot the current live spec into an immutable AgentVersion.
scoped.post('/versions', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const spec = await specFromAgent(agent(req).id);
  const last = await prisma.agentVersion.findFirst({ where: { agentId: agent(req).id }, orderBy: { version: 'desc' } });
  const version = (last?.version || 0) + 1;
  const av = await prisma.agentVersion.create({
    data: { agentId: agent(req).id, version, specJson: JSON.stringify(spec), note: String(req.body?.note || '').slice(0, 200) || null, createdByUserId: (req as any).user.id },
  });
  await prisma.agent.update({ where: { id: agent(req).id }, data: { currentVersionId: av.id } });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'agent.publish_version', targetType: 'agent', targetId: agent(req).id, metadata: { version } });
  res.json({ id: av.id, version });
}));

// Rollback: re-apply a published version's spec to the live rows (the highest-value payoff).
scoped.post('/rollback', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const version = Number(req.body?.version);
  const av = await prisma.agentVersion.findFirst({ where: { agentId: agent(req).id, version } });
  if (!av) return res.status(404).json({ error: 'version not found' });
  const v = validateSpec(JSON.parse(av.specJson));
  if (!v.ok) return res.status(400).json({ error: 'stored spec invalid', issues: v.errors });
  await applySpec(agent(req).id, v.spec);
  await prisma.agent.update({ where: { id: agent(req).id }, data: { currentVersionId: av.id } });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'agent.rollback', targetType: 'agent', targetId: agent(req).id, metadata: { version } });
  res.json({ ok: true, version });
}));

// Clone: create a new agent from this one's spec (secrets stripped — reconnect its channel).
scoped.post('/clone', requirePermission('agent_create'), asyncHandler(async (req, res) => {
  const spec = await specFromAgent(agent(req).id);
  if (!spec) return res.status(404).json({ error: 'agent not found' });
  const orgId = (req as any).user.orgId;
  const sub = await prisma.subscription.findUnique({ where: { orgId } });
  const count = await prisma.agent.count({ where: { orgId } });
  if (sub && count >= sub.maxAgents) return res.status(402).json({ error: 'plan limit reached', code: 'subscription_required' });
  const newName = String(req.body?.name || `${spec.identity.name} (copy)`).slice(0, 80);
  const created = await prisma.agent.create({ data: { orgId, name: newName, channelType: spec.channel.type } });
  await prisma.trainingProfile.create({ data: { agentId: created.id, orgId } });
  await applySpec(created.id, { ...spec, identity: { name: newName } });
  audit({ orgId, actorUserId: (req as any).user.id, action: 'agent.clone', targetType: 'agent', targetId: created.id });
  res.json(created);
}));

// Lifecycle transition (SPEC-11/12): draft -> active -> paused -> archived (NOT connection).
const LIFECYCLE: Record<string, string[]> = { draft: ['active', 'archived'], active: ['paused', 'archived'], paused: ['active', 'archived'], archived: [] };
scoped.post('/lifecycle', requirePermission('train_edit'), asyncHandler(async (req, res) => {
  const to = String(req.body?.status || '');
  const from = (agent(req) as any).lifecycleStatus || 'draft';
  if (!LIFECYCLE[from]?.includes(to)) return res.status(400).json({ error: `cannot move ${from} -> ${to}` });
  await prisma.agent.update({ where: { id: agent(req).id }, data: { lifecycleStatus: to } });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'agent.lifecycle', targetType: 'agent', targetId: agent(req).id, metadata: { from, to } });
  res.json({ ok: true, lifecycleStatus: to });
}));

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
  if (req.body?.channelConfig && typeof req.body.channelConfig === 'object') {
    // SEC-2: encrypt channel secrets at rest (Telegram botToken) rather than storing
    // them as plaintext JSON. Decrypted only at send time (channels/telegram.ts).
    const cc: Record<string, any> = { ...req.body.channelConfig };
    if (typeof cc.botToken === 'string' && cc.botToken && !isEncrypted(cc.botToken)) {
      cc.botToken = encryptSecret(cc.botToken);
    }
    data.channelConfig = JSON.stringify(cc);
  }
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

scoped.delete('/', requirePermission('agent_delete'), asyncHandler(async (req, res) => {
  const adapter = getAdapter(agent(req).channelType);
  if (adapter?.stop) await adapter.stop(agent(req).id).catch(() => {});
  await prisma.agent.delete({ where: { id: agent(req).id } });
  audit({ orgId: (req as any).user.orgId, actorUserId: (req as any).user.id, action: 'agent.delete', targetType: 'agent', targetId: agent(req).id, ip: req.ip });
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
  if (!profile) profile = await prisma.trainingProfile.create({ data: { agentId, orgId: agent(req).orgId } });
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
  const row = await prisma.trainingSource.create({ data: { agentId: agent(req).id, orgId: agent(req).orgId, type, dataJson: JSON.stringify(data || {}) } });
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
  // FND-07: the comment promised owner-only but it was never enforced — a member could
  // drive outbound sends. Gate it until the Phase-5 outbound-drip handler replaces it.
  if ((req as any).user?.role !== 'owner') return res.status(403).json({ error: 'owner only', code: 'forbidden' });
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
