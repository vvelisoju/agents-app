// Telegram channel adapter (B9.6). Low-friction: the business creates a bot with
// @BotFather (free, 30s), pastes the token, and the agent connects by long-polling
// getUpdates — no app review, no password. Normalised to the common InboundMessage.
import { register } from './registry';
import prisma from '../lib/prisma';
import * as realtime from '../lib/realtime';
import { InboundMessage } from './types';

const TG = 'https://api.telegram.org/bot';
const polls = new Map<string, { stop: boolean }>();

async function botToken(agentId: string): Promise<string | null> {
  const a = await prisma.agent.findUnique({ where: { id: agentId } });
  try { return JSON.parse(a?.channelConfig || '{}').botToken || null; } catch { return null; }
}

async function setStatus(agentId: string, status: string) {
  await prisma.agent.update({ where: { id: agentId }, data: { status } }).catch(() => {});
  realtime.emit(agentId, 'status', { status });
}

// Pure: a Telegram update → our InboundMessage (or null to ignore). Unit-tested.
export function normalizeUpdate(update: any): InboundMessage | null {
  const msg = update?.message;
  if (!msg || typeof msg.text !== 'string' || !msg.chat) return null;
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.chat?.title || String(msg.chat.id);
  return { from: 'tg:' + msg.chat.id, contactName: name, text: msg.text };
}

export async function startSession(agentId: string) {
  if (polls.has(agentId)) return;
  const token = await botToken(agentId);
  if (!token) { await setStatus(agentId, 'auth_failed'); throw new Error('Telegram bot token not set — add it first.'); }
  const state = { stop: false };
  polls.set(agentId, state);
  await setStatus(agentId, 'connected');

  let offset = 0;
  (async function loop() {
    while (!state.stop) {
      try {
        const r = await fetch(`${TG}${token}/getUpdates?timeout=25&offset=${offset}`);
        const j: any = await r.json();
        if (!j.ok) { await setStatus(agentId, 'auth_failed'); break; }
        for (const up of j.result || []) {
          offset = up.update_id + 1;
          const inbound = normalizeUpdate(up);
          if (inbound) {
            const engine = require('../engine/engine');
            engine.processInbound(agentId, inbound).catch((e: any) => console.error('tg inbound error:', e?.message));
          }
        }
      } catch {
        await new Promise((res) => setTimeout(res, 3000)); // network hiccup; back off
      }
    }
  })();
}

export async function stopSession(agentId: string) {
  const s = polls.get(agentId);
  if (s) s.stop = true;
  polls.delete(agentId);
  await setStatus(agentId, 'disconnected');
}

export async function sendText(agentId: string, to: string, text: string) {
  const token = await botToken(agentId);
  if (!token) throw new Error('Telegram bot token not set');
  await fetch(`${TG}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: to.replace(/^tg:/, ''), text }),
  });
}

register({ type: 'telegram', onboarding: 'token', start: startSession, stop: stopSession, send: sendText });
