// =============================================================
// src/whatsapp.ts — WhatsApp session manager (skeleton).
// One whatsapp-web.js Client per agent, keyed by agentId. Emits
// QR + status over the realtime hub and routes inbound messages
// to the reply engine. Sessions persist in .wwebjs_auth/ so they
// survive restarts (production: RemoteAuth in DB/S3 — see docs).
// =============================================================
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg as any;
import qrcode from 'qrcode';
import path from 'path';
import * as realtime from './realtime';
import { setAgentStatus, getAgent } from './db';

const clients = new Map<string, any>();

export function sessionStatus(agentId: string): string {
  const a = getAgent(agentId);
  return a ? a.status : 'unknown';
}

export async function startSession(agentId: string) {
  if (clients.has(agentId)) return; // already running
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: agentId,
      dataPath: path.join(__dirname, '..', '.wwebjs_auth'),
    }),
    authTimeoutMs: 90000,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox'],
    },
  });
  clients.set(agentId, client);

  client.on('qr', async (qr: string) => {
    setAgentStatus(agentId, 'pending_qr');
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      realtime.emit(agentId, 'qr', { dataUrl });
    } catch { /* ignore */ }
    realtime.emit(agentId, 'status', { status: 'pending_qr' });
  });
  client.on('authenticated', () => {
    setAgentStatus(agentId, 'connecting');
    realtime.emit(agentId, 'status', { status: 'connecting' });
  });
  client.on('ready', () => {
    setAgentStatus(agentId, 'connected');
    realtime.emit(agentId, 'status', { status: 'connected' });
  });
  client.on('auth_failure', () => {
    setAgentStatus(agentId, 'auth_failed');
    realtime.emit(agentId, 'status', { status: 'auth_failed' });
  });
  client.on('disconnected', () => {
    setAgentStatus(agentId, 'disconnected');
    realtime.emit(agentId, 'status', { status: 'disconnected' });
    clients.delete(agentId);
  });
  client.on('message', (msg: any) => {
    // Lazy require avoids a circular import (engine -> whatsapp -> engine).
    const engine = require('./engine');
    engine.handleInbound(agentId, msg).catch((e: any) => console.error('inbound error:', e?.message || e));
  });

  client.initialize();
}

export async function stopSession(agentId: string) {
  const c = clients.get(agentId);
  if (c) {
    try { await c.destroy(); } catch { /* ignore */ }
    clients.delete(agentId);
  }
  setAgentStatus(agentId, 'disconnected');
  realtime.emit(agentId, 'status', { status: 'disconnected' });
}

export async function sendText(agentId: string, to: string, text: string) {
  const c = clients.get(agentId);
  if (!c) throw new Error('agent session not connected');
  await c.sendMessage(to, text);
}

// Restore sessions that were connected before a restart.
export function restoreSessions(agentIds: string[]) {
  for (const id of agentIds) startSession(id).catch((e) => console.error('restore failed', id, e?.message));
}
