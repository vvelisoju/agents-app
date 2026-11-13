// =============================================================
// src/index.ts — the Phase 1 skeleton server. Boots the DB, the
// REST API, the WebSocket hub, and restores WhatsApp sessions.
// Run:  npm run dev   (then open http://localhost:4000)
// =============================================================
require('dotenv').config();
import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';

import db, {
  uid, createUserOrg, getUserByEmail, createAgent, listAgents, getAgent,
  setAutoSend, getProfile, updateProfile, listSources, addSource, updateSource,
  deleteSource, listConversations, listMessages, insertMessage,
} from './db';
import { hashPassword, verifyPassword, newToken, authMiddleware } from './auth';
import * as wa from './whatsapp';
import { draftFor } from './engine';
import { attachWs } from './realtime';
import { trainingSummary } from './training';
import { learnFromUrl } from './learn';

const app = express();
app.use(express.json());

// ---- helpers ----------------------------------------------------
function ownedAgent(req: Request, res: Response): any | null {
  const agent = getAgent(String(req.params.id));
  const user = (req as any).user;
  if (!agent || agent.org_id !== user.org_id) {
    res.status(404).json({ error: 'agent not found' });
    return null;
  }
  return agent;
}

// ---- auth -------------------------------------------------------
app.post('/api/auth/signup', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'email already registered' });
  const user = createUserOrg(email, hashPassword(password), newToken());
  res.json({ token: user.token, email: user.email });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = getUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }
  res.json({ token: user.token, email: user.email });
});

app.get('/api/me', authMiddleware, (req, res) => {
  const user = (req as any).user;
  res.json({ email: user.email, orgId: user.org_id });
});

// ---- agents (all require auth) ----------------------------------
app.use('/api/agents', authMiddleware);

app.get('/api/agents', (req, res) => {
  res.json(listAgents((req as any).user.org_id).map((a) => ({ ...a, auto_send: !!a.auto_send })));
});

app.post('/api/agents', (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  res.json(createAgent((req as any).user.org_id, name));
});

app.get('/api/agents/:id', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  res.json({ ...agent, auto_send: !!agent.auto_send });
});

app.patch('/api/agents/:id', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  if (typeof req.body?.auto_send === 'boolean') setAutoSend(agent.id, req.body.auto_send);
  res.json({ ...getAgent(agent.id), auto_send: !!getAgent(agent.id).auto_send });
});

app.post('/api/agents/:id/connect', async (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  await wa.startSession(agent.id); // QR + status arrive over WebSocket
  res.json({ ok: true, status: 'connecting' });
});

app.post('/api/agents/:id/disconnect', async (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  await wa.stopSession(agent.id);
  res.json({ ok: true });
});

// ---- training ---------------------------------------------------
app.get('/api/agents/:id/training', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  const profile = getProfile(agent.id);
  const sources = listSources(agent.id);
  res.json({ profile, sources, summary: trainingSummary(profile, sources) });
});

app.put('/api/agents/:id/training/profile', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  res.json(updateProfile(agent.id, req.body || {}));
});

// Train from a link: paste a website / Google / Instagram / Facebook link and
// get back a confirmable training draft (instructions, tone, facts, FAQs,
// links). Nothing is saved here — the owner confirms, then the normal
// profile + sources endpoints persist what they kept.
app.post('/api/agents/:id/training/learn', async (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  const url = (req.body?.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Paste a link to learn from.' });
  try {
    res.json(await learnFromUrl(agent.name, url));
  } catch (e: any) {
    res.status(422).json({ error: e?.message || 'Could not learn from that link.' });
  }
});

app.post('/api/agents/:id/training/sources', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  const { type, data } = req.body || {};
  if (!['fact', 'link', 'faq'].includes(type)) return res.status(400).json({ error: 'bad source type' });
  const id = addSource(agent.id, type, data || {});
  res.json({ id });
});

app.patch('/api/agents/:id/training/sources/:sid', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  updateSource(String(req.params.sid), req.body || {});
  res.json({ ok: true });
});

app.delete('/api/agents/:id/training/sources/:sid', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  deleteSource(String(req.params.sid));
  res.json({ ok: true });
});

// Test Console: try a question, see the draft (no send, no log).
app.post('/api/agents/:id/test', async (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  const message = (req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    res.json({ draft: await draftFor(agent.id, message) });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'failed' });
  }
});

// ---- conversations / messages -----------------------------------
app.get('/api/agents/:id/conversations', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  res.json(listConversations(agent.id));
});

app.get('/api/agents/:id/conversations/:cid/messages', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  res.json(listMessages(String(req.params.cid)));
});

// Approve or skip a pending draft.
app.post('/api/agents/:id/messages/:mid/approve', async (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.mid) as any;
  if (!msg || msg.agent_id !== agent.id) return res.status(404).json({ error: 'message not found' });
  const conv = db.prepare('SELECT * FROM conversations WHERE id=?').get(msg.conversation_id) as any;
  try {
    await wa.sendText(agent.id, conv.contact_number, msg.body);
    db.prepare("UPDATE messages SET status='sent' WHERE id=?").run(msg.id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'send failed' });
  }
});

app.post('/api/agents/:id/messages/:mid/skip', (req, res) => {
  const agent = ownedAgent(req, res); if (!agent) return;
  db.prepare("UPDATE messages SET status='skipped' WHERE id=? AND agent_id=?").run(req.params.mid, agent.id);
  res.json({ ok: true });
});

// ---- static dashboard + boot ------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
attachWs(server);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`\n✅ Platform listening on http://localhost:${PORT}`);
  console.log(`   Open that URL to sign up, add a WhatsApp agent, train it, and watch it reply.`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('   ⚠️  ANTHROPIC_API_KEY not set — replies will fail until you add it to platform/.env');
  }
});

// Restore any sessions that were connected before a restart.
try {
  const ids = (db.prepare("SELECT id FROM agents WHERE status='connected'").all() as any[]).map((r) => r.id);
  if (ids.length) {
    console.log(`Restoring ${ids.length} WhatsApp session(s)...`);
    wa.restoreSessions(ids);
  }
} catch (e: any) {
  console.error('session restore error:', e?.message || e);
}
