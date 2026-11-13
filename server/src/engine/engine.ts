// The reply engine — fully channel-agnostic. Adapters hand it a normalised
// InboundMessage; it loads the agent's CURRENT training, asks Claude, then
// either delivers via the channel adapter (auto-send) or saves a draft.
import prisma from '../lib/prisma';
import { askClaude } from '../lib/brain';
import { composeSystemPrompt, applyLinks, extractAlert, Source } from '../lib/training';
import { toWhatsappChatId } from '../lib/phone';
import * as realtime from '../lib/realtime';
import { getAdapter } from '../channels/registry';
import { InboundMessage } from '../channels/types';

// Don't re-ping the owner about the same lead more than once per this window.
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

// A customer contact id for display: strip channel suffix/prefix.
function prettyContact(from: string): string {
  return (from || '').replace(/@c\.us$/, '').replace(/^web:/, '');
}

// Fire-and-forget: WhatsApp the owner about a hot lead, via the agent's own
// channel session. Deduped by Conversation.alertedAt. Never throws into the
// reply path — a failed alert must not break the customer reply.
async function alertOwner(agent: any, conv: any, inbound: InboundMessage, reason: string): Promise<void> {
  try {
    if (!agent.alertNumber) return;
    const chatId = toWhatsappChatId(agent.alertNumber);
    if (!chatId) return;
    // Cooldown: skip if we already alerted on this lead recently.
    const last = conv.alertedAt ? new Date(conv.alertedAt).getTime() : 0;
    if (last && Date.now() - last < ALERT_COOLDOWN_MS) return;

    const adapter = getAdapter(agent.channelType);
    if (!adapter) return;
    const who = conv.contactName && conv.contactName !== prettyContact(inbound.from)
      ? `${conv.contactName} · ${prettyContact(inbound.from)}`
      : prettyContact(inbound.from);
    const said = (inbound.text || '').trim().slice(0, 180);
    const body =
      `🔔 *${agent.name}* flagged a chat for you\n` +
      `${who}\n` +
      `${reason}\n\n` +
      `They said: "${said}"\n\n` +
      `👉 Open the chat and jump in.`;

    await adapter.send(agent.id, chatId, body);
    await prisma.conversation.update({ where: { id: conv.id }, data: { alertedAt: new Date() } });
    realtime.emit(agent.id, 'alert', { conversationId: conv.id, reason });
  } catch (e: any) {
    console.error('owner alert failed:', e?.message || e);
  }
}

const ACKS = new Set([
  'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'ty', 'thx', 'thankyou',
  'great', 'good', 'nice', 'done', 'cool', 'fine', 'welcome', '👍', '🙏', '👌', '❤️',
]);
function worthReplying(body: string): boolean {
  const t = (body || '').trim().toLowerCase();
  if (!t) return false;
  return !ACKS.has(t);
}

function buildPrompt(convoText: string): string {
  return (
    `Here is the recent WhatsApp conversation with a customer:\n\n${convoText}\n\n` +
    `Write the business's next reply to the customer's most recent message. ` +
    `Reply with ONLY the message text to send, nothing else.`
  );
}

async function loadTraining(agentId: string): Promise<{ profile: any; sources: Source[] }> {
  const profile = await prisma.trainingProfile.findUnique({ where: { agentId } });
  const rows = await prisma.trainingSource.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
  const sources: Source[] = rows.map((r) => ({ id: r.id, type: r.type as any, data: JSON.parse(r.dataJson), enabled: r.enabled }));
  return { profile, sources };
}

// Test Console: compose + call Claude for one message (no send, no log).
// Returns the clean customer reply and, if the model flagged it, the urgent reason
// so the owner can see the alert this message WOULD have triggered.
export async function draftFor(agent: any, message: string): Promise<{ draft: string; urgentReason: string | null }> {
  const { profile, sources } = await loadTraining(agent.id);
  const system = composeSystemPrompt(agent, profile, sources);
  const raw = await askClaude({ system, prompt: buildPrompt(`Customer: ${message}`) });
  const { reason, clean } = extractAlert(raw);
  return { draft: applyLinks(clean, sources), urgentReason: reason };
}

export interface ProcessResult {
  status: 'ignored' | 'no_agent' | 'error' | 'empty' | 'needs_human' | 'sent' | 'draft' | 'away';
  reply?: string;
  conversationId?: string;
}

// Current hour (0-23) in the agent's timezone, for business hours.
function currentHourInTz(tz: string): number {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date());
    return parseInt(s, 10) % 24;
  } catch { return new Date().getHours(); }
}

// Handle one normalised inbound message from any channel.
export async function processInbound(agentId: string, inbound: InboundMessage): Promise<ProcessResult> {
  const text = (inbound.text || '').trim();
  if (!worthReplying(text)) return { status: 'ignored' };

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { status: 'no_agent' };

  const contactName = inbound.contactName || inbound.from.split('@')[0];
  const conv = await prisma.conversation.upsert({
    where: { agentId_contactNumber: { agentId, contactNumber: inbound.from } },
    update: { lastMessageAt: new Date(), contactName },
    create: { agentId, orgId: agent.orgId, contactNumber: inbound.from, contactName },
  });
  await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'inbound', body: text, status: 'received' } });
  realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'received' });

  // Respect agent pause, per-conversation human takeover, and mute: still log the
  // inbound (owner sees it), but the AI does not reply.
  if (agent.paused || conv.takenOver || conv.muted) return { status: 'ignored', conversationId: conv.id };

  // Business hours: outside the window, send the away message ONCE (then stay quiet
  // until the next real reply), so we never spam "we're closed" on every message.
  if (agent.hoursStart != null && agent.hoursEnd != null && agent.awayMessage) {
    const hour = currentHourInTz(agent.timezone);
    const inHours = agent.hoursStart <= agent.hoursEnd
      ? (hour >= agent.hoursStart && hour < agent.hoursEnd)
      : (hour >= agent.hoursStart || hour < agent.hoursEnd); // overnight window
    if (!inHours) {
      const lastOut = await prisma.message.findFirst({ where: { conversationId: conv.id, direction: 'outbound' }, orderBy: { createdAt: 'desc' } });
      if (lastOut?.status === 'away') return { status: 'ignored', conversationId: conv.id };
      const adapter = getAdapter(agent.channelType);
      try { if (adapter) await adapter.send(agentId, inbound.from, agent.awayMessage); } catch { /* ignore */ }
      await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'outbound', body: agent.awayMessage, status: 'away' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'away' });
      return { status: 'away', reply: agent.awayMessage, conversationId: conv.id };
    }
  }

  const { profile, sources } = await loadTraining(agentId);
  const system = composeSystemPrompt(agent, profile, sources);
  const history = (await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 8 }))
    .reverse().map((m) => `${m.direction === 'outbound' ? 'Me (business)' : 'Customer'}: ${m.body}`).join('\n');

  let draft: string;
  try {
    draft = await askClaude({ system, prompt: buildPrompt(history || `Customer: ${text}`) });
  } catch (e: any) {
    console.error('Claude error:', e?.message || e);
    return { status: 'error', conversationId: conv.id };
  }
  if (!draft) return { status: 'empty', conversationId: conv.id };

  const esc = profile?.escalationKeyword || 'NEEDS_HUMAN';
  if (draft.includes(esc)) {
    await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'outbound', body: '[needs a human]', status: 'needs_human' } });
    realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'needs_human' });
    return { status: 'needs_human', conversationId: conv.id };
  }

  // Pull out any urgent-lead signal and strip it from the customer-facing reply.
  const { reason: urgentReason, clean } = extractAlert(draft);
  if (urgentReason) { await alertOwner(agent, conv, inbound, urgentReason); }
  draft = applyLinks(clean, sources);
  if (!draft) return { status: 'ignored', conversationId: conv.id }; // reply was only the alert line
  await prisma.usageEvent.create({ data: { orgId: agent.orgId, agentId } });

  if (agent.autoSend) {
    const adapter = getAdapter(agent.channelType);
    try {
      if (adapter) await adapter.send(agentId, inbound.from, draft);
      await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'outbound', body: draft, status: 'sent' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'sent' });
      return { status: 'sent', reply: draft, conversationId: conv.id };
    } catch (e: any) {
      console.error('send failed:', e?.message || e);
      await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'outbound', body: draft, status: 'draft' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'draft' });
      return { status: 'draft', reply: draft, conversationId: conv.id };
    }
  }

  await prisma.message.create({ data: { conversationId: conv.id, agentId, direction: 'outbound', body: draft, status: 'draft' } });
  realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'draft' });
  return { status: 'draft', reply: draft, conversationId: conv.id };
}
