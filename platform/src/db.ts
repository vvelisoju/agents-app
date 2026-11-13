// =============================================================
// src/db.ts — SQLite data layer (skeleton).
// Production target is PostgreSQL + pgvector (see docs/DATA_MODEL.md);
// SQLite keeps the skeleton zero-setup and runnable immediately.
// =============================================================
import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'owner',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'active',
  max_agents INTEGER DEFAULT 10,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  channel_type TEXT DEFAULT 'whatsapp-web',
  status TEXT DEFAULT 'draft',
  auto_send INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS training_profiles (
  agent_id TEXT PRIMARY KEY,
  instructions TEXT DEFAULT '',
  restrictions TEXT DEFAULT '',
  tone TEXT DEFAULT 'warm, concise, helpful',
  language TEXT DEFAULT 'match the customer',
  escalation_keyword TEXT DEFAULT 'NEEDS_HUMAN',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS training_sources (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,            -- 'fact' | 'link' | 'faq'
  data_json TEXT NOT NULL,       -- {content} | {name,url} | {question,answer}
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  contact_number TEXT NOT NULL,
  contact_name TEXT,
  last_message_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  direction TEXT NOT NULL,       -- 'inbound' | 'outbound'
  body TEXT,
  status TEXT,                   -- received | draft | sent | skipped | needs_human
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT DEFAULT 'reply',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

export const uid = () => crypto.randomUUID();

// ---- auth / orgs ----
export function createUserOrg(email: string, passwordHash: string, token: string) {
  const orgId = uid(), userId = uid();
  const name = email.split('@')[0] + "'s workspace";
  db.prepare('INSERT INTO orgs (id, name) VALUES (?, ?)').run(orgId, name);
  db.prepare('INSERT INTO subscriptions (id, org_id) VALUES (?, ?)').run(uid(), orgId);
  db.prepare('INSERT INTO users (id, org_id, email, password_hash, token) VALUES (?,?,?,?,?)')
    .run(userId, orgId, email, passwordHash, token);
  return getUserByToken(token);
}
export const getUserByEmail = (email: string) =>
  db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
export const getUserByToken = (token: string) =>
  db.prepare('SELECT * FROM users WHERE token = ?').get(token) as any;

// ---- agents ----
export function createAgent(orgId: string, name: string) {
  const id = uid();
  db.prepare('INSERT INTO agents (id, org_id, name) VALUES (?,?,?)').run(id, orgId, name);
  db.prepare('INSERT INTO training_profiles (agent_id) VALUES (?)').run(id);
  return getAgent(id);
}
export const listAgents = (orgId: string) =>
  db.prepare('SELECT * FROM agents WHERE org_id = ? ORDER BY created_at').all(orgId) as any[];
export const getAgent = (id: string) =>
  db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
export const setAgentStatus = (id: string, status: string) =>
  db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id);
export const setAutoSend = (id: string, on: boolean) =>
  db.prepare('UPDATE agents SET auto_send = ? WHERE id = ?').run(on ? 1 : 0, id);

// ---- training ----
export const getProfile = (agentId: string) =>
  db.prepare('SELECT * FROM training_profiles WHERE agent_id = ?').get(agentId) as any;
export function updateProfile(agentId: string, p: any) {
  db.prepare(`UPDATE training_profiles SET instructions=?, restrictions=?, tone=?, language=?,
    escalation_keyword=?, updated_at=datetime('now') WHERE agent_id=?`)
    .run(p.instructions ?? '', p.restrictions ?? '', p.tone ?? '', p.language ?? '',
         p.escalation_keyword || 'NEEDS_HUMAN', agentId);
  return getProfile(agentId);
}
export const listSources = (agentId: string) =>
  (db.prepare('SELECT * FROM training_sources WHERE agent_id = ? ORDER BY created_at').all(agentId) as any[])
    .map((s) => ({ ...s, data: JSON.parse(s.data_json), enabled: !!s.enabled }));
export function addSource(agentId: string, type: string, data: any) {
  const id = uid();
  db.prepare('INSERT INTO training_sources (id, agent_id, type, data_json) VALUES (?,?,?,?)')
    .run(id, agentId, type, JSON.stringify(data));
  return id;
}
export function updateSource(id: string, patch: any) {
  const row = db.prepare('SELECT * FROM training_sources WHERE id = ?').get(id) as any;
  if (!row) return;
  const data = patch.data ? JSON.stringify(patch.data) : row.data_json;
  const enabled = patch.enabled === undefined ? row.enabled : (patch.enabled ? 1 : 0);
  db.prepare('UPDATE training_sources SET data_json=?, enabled=? WHERE id=?').run(data, enabled, id);
}
export const deleteSource = (id: string) =>
  db.prepare('DELETE FROM training_sources WHERE id = ?').run(id);

// ---- conversations / messages ----
export function upsertConversation(agentId: string, orgId: string, number: string, name: string) {
  let c = db.prepare('SELECT * FROM conversations WHERE agent_id=? AND contact_number=?')
    .get(agentId, number) as any;
  if (!c) {
    const id = uid();
    db.prepare('INSERT INTO conversations (id, agent_id, org_id, contact_number, contact_name) VALUES (?,?,?,?,?)')
      .run(id, agentId, orgId, number, name);
    c = db.prepare('SELECT * FROM conversations WHERE id=?').get(id);
  } else {
    db.prepare("UPDATE conversations SET last_message_at=datetime('now'), contact_name=? WHERE id=?")
      .run(name, c.id);
  }
  return c;
}
export const listConversations = (agentId: string) =>
  db.prepare('SELECT * FROM conversations WHERE agent_id=? ORDER BY last_message_at DESC').all(agentId) as any[];
export function insertMessage(conversationId: string, agentId: string, direction: string, body: string, status: string) {
  const id = uid();
  db.prepare('INSERT INTO messages (id, conversation_id, agent_id, direction, body, status) VALUES (?,?,?,?,?,?)')
    .run(id, conversationId, agentId, direction, body, status);
  return id;
}
export const listMessages = (conversationId: string) =>
  db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(conversationId) as any[];
export const recentMessages = (conversationId: string, limit = 8) =>
  (db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?')
    .all(conversationId, limit) as any[]).reverse();
export const logUsage = (orgId: string, agentId: string) =>
  db.prepare('INSERT INTO usage_events (id, org_id, agent_id) VALUES (?,?,?)').run(uid(), orgId, agentId);

export default db;
