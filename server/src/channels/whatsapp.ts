// WhatsApp channel adapter (whatsapp-web.js). One Client per agent. Normalises
// inbound messages to InboundMessage and registers itself in the adapter registry.
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg as any;
import qrcode from 'qrcode';
import path from 'path';
import prisma from '../lib/prisma';
import * as realtime from '../lib/realtime';
import { register } from './registry';

const clients = new Map<string, any>();

async function setStatus(agentId: string, status: string) {
  await prisma.agent.update({ where: { id: agentId }, data: { status } }).catch(() => {});
  await prisma.channelSession.upsert({
    where: { agentId },
    update: { status, ...(status === 'connected' ? { lastConnectedAt: new Date() } : {}) },
    create: { agentId, status },
  }).catch(() => {});
}

export async function startSession(agentId: string) {
  if (clients.has(agentId)) return;
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: agentId, dataPath: path.join(__dirname, '..', '..', '.wwebjs_auth') }),
    authTimeoutMs: 90000,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    puppeteer: {
      headless: true,
      // In Docker, point at the system Chromium (PUPPETEER_EXECUTABLE_PATH); locally
      // undefined lets puppeteer use its bundled download.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox'],
    },
  });
  clients.set(agentId, client);

  client.on('qr', async (qr: string) => {
    await setStatus(agentId, 'pending_qr');
    try { realtime.emit(agentId, 'qr', { dataUrl: await qrcode.toDataURL(qr) }); } catch { /* ignore */ }
    realtime.emit(agentId, 'status', { status: 'pending_qr' });
  });
  client.on('authenticated', async () => { await setStatus(agentId, 'connecting'); realtime.emit(agentId, 'status', { status: 'connecting' }); });
  client.on('ready', async () => { await setStatus(agentId, 'connected'); realtime.emit(agentId, 'status', { status: 'connected' }); });
  client.on('auth_failure', async () => { await setStatus(agentId, 'auth_failed'); realtime.emit(agentId, 'status', { status: 'auth_failed' }); });
  client.on('disconnected', async () => { await setStatus(agentId, 'disconnected'); realtime.emit(agentId, 'status', { status: 'disconnected' }); clients.delete(agentId); });

  client.on('message', async (msg: any) => {
    try {
      if (msg.isStatus || msg.from === 'status@broadcast') return;
      const chat = await msg.getChat();
      if (chat.isGroup) return;
      const body = (msg.body || '').trim();
      if (!body) return;
      const number = (msg.author || msg.from).split('@')[0];
      let contactName = number;
      try { const c = await msg.getContact(); contactName = c.pushname || c.name || number; } catch { /* ignore */ }
      const engine = require('../engine/engine');
      await engine.processInbound(agentId, { from: msg.from, contactName, text: body });
    } catch (e: any) {
      console.error('wa inbound error:', e?.message || e);
    }
  });

  client.initialize();
}

export async function stopSession(agentId: string) {
  const c = clients.get(agentId);
  if (c) { try { await c.destroy(); } catch { /* ignore */ } clients.delete(agentId); }
  await setStatus(agentId, 'disconnected');
  realtime.emit(agentId, 'status', { status: 'disconnected' });
}

export async function sendText(agentId: string, to: string, text: string) {
  const c = clients.get(agentId);
  if (!c) throw new Error('agent session not connected');
  await c.sendMessage(to, text);
}

export function restoreSessions(ids: string[]) {
  for (const id of ids) startSession(id).catch((e) => console.error('restore failed', id, e?.message));
}

// Register this channel.
register({ type: 'whatsapp-web', onboarding: 'qr', start: startSession, stop: stopSession, send: sendText });
