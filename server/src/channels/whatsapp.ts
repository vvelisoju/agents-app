// WhatsApp channel adapter (whatsapp-web.js). One Client per agent. Normalises
// inbound messages to InboundMessage and registers itself in the adapter registry.
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg as any;
import qrcode from 'qrcode';
import path from 'path';
import prisma from '../lib/prisma';
import * as realtime from '../lib/realtime';
import { register } from './registry';

const clients = new Map<string, any>();

// Where whatsapp-web.js stores each agent's login session. On an ephemeral host
// (Railway/containers), the default local path is WIPED on every deploy, which
// forces a re-scan of the QR after each deploy. Point WWEBJS_DATA_PATH at a
// PERSISTENT VOLUME (e.g. /data/wwebjs_auth) so the session survives deploys.
const AUTH_DIR = process.env.WWEBJS_DATA_PATH || path.join(__dirname, '..', '..', '.wwebjs_auth');

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
    authStrategy: new LocalAuth({ clientId: agentId, dataPath: AUTH_DIR }),
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

// --- TEMPORARY: promo send smoke test (used by the gated /test-send route). ---
// Additive helpers; the existing reply paths above are untouched. Safe to remove
// once the Trackly → outbound integration is built for real.

// Resolve + validate a number on WhatsApp; returns the chat id (…@c.us) or null.
export async function resolveNumber(agentId: string, digits: string): Promise<string | null> {
  const c = clients.get(agentId);
  if (!c) throw new Error('agent session not connected');
  const id = await c.getNumberId(digits);
  return id ? id._serialized : null;
}

// Send an image (from a URL) with an optional caption, or fall back to text.
export async function sendMedia(agentId: string, to: string, mediaUrl: string, caption?: string): Promise<string | null> {
  const c = clients.get(agentId);
  if (!c) throw new Error('agent session not connected');
  const media = await MessageMedia.fromUrl(mediaUrl, { unsafeMime: true });
  const msg = await c.sendMessage(to, media, caption ? { caption } : {});
  return msg?.id?._serialized || null;
}

export function restoreSessions(ids: string[]) {
  for (const id of ids) startSession(id).catch((e) => console.error('restore failed', id, e?.message));
}

// Register this channel.
register({ type: 'whatsapp-web', onboarding: 'qr', label: 'WhatsApp', blurb: 'Reply to WhatsApp customers', ready: true, capabilities: ['text', 'images'], start: startSession, stop: stopSession, send: sendText });
