// The reply engine — fully channel-agnostic. Adapters hand it a normalised
// InboundMessage; it loads the agent's CURRENT training, asks Claude, then
// either delivers via the channel adapter (auto-send) or saves a draft.
import crypto from 'node:crypto';
import prisma from '../lib/prisma';
import { askClaude, generate } from '../lib/brain';
import { writeTrace } from '../lib/trace';
import { canSpend } from '../lib/budget';
import { composeSystemPrompt, applyLinks, extractAlert, Source } from '../lib/training';
import { toWhatsappChatId } from '../lib/phone';
import * as realtime from '../lib/realtime';
import { getAdapter } from '../channels/registry';
import { InboundMessage } from '../channels/types';
import { outboundEnabled } from '../lib/spineEnv';
import { isOptOutMessage, suppressContact, OPT_OUT_CONFIRMATION } from '../lib/optout';
import { withSendLock } from '../lib/sendMutex';
import { runAgenticLoop } from './agentic';

// TOOL-14: an agent's enabled tool allowlist (JSON string[]), empty by default.
function parseEnabledTools(agent: any): string[] {
  try { const a = JSON.parse(agent.enabledToolsJson || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}

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

// SCN-01: channel label defaults to "WhatsApp" so existing WhatsApp prompts are byte-identical.
function buildPrompt(convoText: string, channel = 'WhatsApp'): string {
  return (
    `Here is the recent ${channel} conversation with a customer:\n\n${convoText}\n\n` +
    `Write the business's next reply to the customer's most recent message. ` +
    `Reply with ONLY the message text to send, nothing else.`
  );
}

// The channel display name for prompts, from the adapter (falls back to WhatsApp).
function channelLabel(channelType: string): string {
  return getAdapter(channelType)?.label || 'WhatsApp';
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
  const raw = await askClaude({ system, prompt: buildPrompt(`Customer: ${message}`, channelLabel(agent.channelType)) });
  const { reason, clean } = extractAlert(raw);
  return { draft: applyLinks(clean, sources), urgentReason: reason };
}

export interface ProcessResult {
  status: 'ignored' | 'no_agent' | 'error' | 'empty' | 'needs_human' | 'sent' | 'draft' | 'away' | 'budget_exceeded' | 'opted_out';
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

// FND-30: per-conversation serialization lock. Two messages from the SAME contact
// (e.g. a rapid double-send, or Telegram's fire-and-forget handler) must not run
// concurrently — otherwise each loads the same history and the agent double-replies.
// Keyed by agent+contact so different conversations still run in parallel. The chain
// is deleted once it drains, so the map never grows unbounded. Single-process only;
// a horizontal move must swap this for a Postgres advisory lock (see QA-59).
const convChains = new Map<string, Promise<unknown>>();

function withConversationLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = convChains.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn); // run after the previous one settles, pass or fail
  const guarded = result.then(() => {}, () => {});
  convChains.set(key, guarded);
  guarded.then(() => { if (convChains.get(key) === guarded) convChains.delete(key); });
  return result;
}

// Handle one normalised inbound message from any channel. Serialized per conversation.
export function processInbound(agentId: string, inbound: InboundMessage): Promise<ProcessResult> {
  return withConversationLock(`${agentId}:${inbound.from}`, () => processInboundLocked(agentId, inbound));
}

async function processInboundLocked(agentId: string, inbound: InboundMessage): Promise<ProcessResult> {
  const text = (inbound.text || '').trim();
  if (!worthReplying(text)) return { status: 'ignored' };

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { status: 'no_agent' };
  const executionId = crypto.randomUUID();

  const contactName = inbound.contactName || inbound.from.split('@')[0];
  const conv = await prisma.conversation.upsert({
    where: { agentId_contactNumber: { agentId, contactNumber: inbound.from } },
    update: { lastMessageAt: new Date(), contactName },
    create: { agentId, orgId: agent.orgId, contactNumber: inbound.from, contactName },
  });
  await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'inbound', body: text, status: 'received' } });
  realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'received' });

  // SCN-10: outbound STOP/unsubscribe opt-out. Gated by OUTBOUND_ENABLED (off → byte-for-byte
  // today). A match suppresses the contact (the drip skips it), sends ONE neutral confirmation,
  // and does NOT AI-reply. Any other message flows to the agent exactly as before.
  if (outboundEnabled() && isOptOutMessage(text)) {
    await suppressContact(agent.orgId, agentId, inbound.from);
    const adapter = getAdapter(agent.channelType);
    try { if (adapter) await withSendLock(agentId, () => adapter.send(agentId, inbound.from, OPT_OUT_CONFIRMATION)); } catch { /* confirmation is best-effort */ }
    await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: OPT_OUT_CONFIRMATION, status: 'opted_out' } });
    realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'opted_out' });
    return { status: 'opted_out', conversationId: conv.id };
  }

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
      await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: agent.awayMessage, status: 'away' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'away' });
      return { status: 'away', reply: agent.awayMessage, conversationId: conv.id };
    }
  }

  // MGW-10/11: per-tenant daily budget. Every channel (incl. the public widget) funnels
  // through here, so one check caps model spend across all of them.
  const spend = await canSpend(agent.orgId);
  if (!spend.allowed) {
    writeTrace({ orgId: agent.orgId, agentId, executionId, conversationId: conv.id, outcome: 'budget_exceeded' });
    return { status: 'budget_exceeded', conversationId: conv.id };
  }

  const { profile, sources } = await loadTraining(agentId);
  const system = composeSystemPrompt(agent, profile, sources);
  const history = (await prisma.message.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 8 }))
    .reverse().map((m) => `${m.direction === 'outbound' ? 'Me (business)' : 'Customer'}: ${m.body}`).join('\n');

  let draft: string;
  let model!: Awaited<ReturnType<typeof generate>>;
  // TOOL-05/14: the agentic tool loop is a sibling path, taken ONLY when the owner put the agent
  // in 'agentic' mode AND enabled at least one tool. Otherwise this is byte-for-byte the single
  // Haiku call. The deterministic post-processing below (NEEDS_HUMAN / [[ALERT]] / {{LINK}}) is
  // identical for both paths (TOOL-06).
  const enabledTools = parseEnabledTools(agent);
  const agentic = agent.executionMode === 'agentic' && enabledTools.length > 0;
  try {
    if (agentic) {
      const r = await runAgenticLoop({
        system,
        userText: history || `Customer: ${text}`,
        enabledTools,
        ctx: { agent, orgId: agent.orgId, conversationId: conv.id, executionId },
      });
      draft = r.text;
      model = { text: r.text, model: r.model, provider: r.provider, inputTokens: r.inputTokens, outputTokens: r.outputTokens, latencyMs: 0, stopReason: 'end_turn', refused: false };
    } else {
      model = await generate({ system, prompt: buildPrompt(history || `Customer: ${text}`, channelLabel(agent.channelType)) });
      draft = model.text;
    }
  } catch (e: any) {
    console.error('Claude error:', e?.message || e);
    writeTrace({ orgId: agent.orgId, agentId, executionId, conversationId: conv.id, outcome: 'error', errorCode: 'model_error' });
    return { status: 'error', conversationId: conv.id };
  }
  if (!draft) return { status: 'empty', conversationId: conv.id };

  const esc = profile?.escalationKeyword || 'NEEDS_HUMAN';
  if (draft.includes(esc)) {
    await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: '[needs a human]', status: 'needs_human' } });
    realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'needs_human' });
    return { status: 'needs_human', conversationId: conv.id };
  }

  // Pull out any urgent-lead signal and strip it from the customer-facing reply.
  const { reason: urgentReason, clean } = extractAlert(draft);
  if (urgentReason) { await alertOwner(agent, conv, inbound, urgentReason); }
  draft = applyLinks(clean, sources);
  if (!draft) return { status: 'ignored', conversationId: conv.id }; // reply was only the alert line
  // OBS-1: one execution-trace row per produced reply (enriched UsageEvent).
  writeTrace({
    orgId: agent.orgId, agentId, executionId, conversationId: conv.id,
    outcome: agent.autoSend ? 'sent' : 'draft',
    approvalState: agent.autoSend ? 'auto' : 'draft',
    model: model.model, provider: model.provider,
    inputTokens: model.inputTokens, outputTokens: model.outputTokens, latencyMs: model.latencyMs,
  });

  if (agent.autoSend) {
    const adapter = getAdapter(agent.channelType);
    try {
      if (adapter) await adapter.send(agentId, inbound.from, draft);
      await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: draft, status: 'sent' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'sent' });
      return { status: 'sent', reply: draft, conversationId: conv.id };
    } catch (e: any) {
      console.error('send failed:', e?.message || e);
      await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: draft, status: 'draft' } });
      realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'draft' });
      return { status: 'draft', reply: draft, conversationId: conv.id };
    }
  }

  await prisma.message.create({ data: { conversationId: conv.id, orgId: agent.orgId, agentId, direction: 'outbound', body: draft, status: 'draft' } });
  realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'draft' });
  return { status: 'draft', reply: draft, conversationId: conv.id };
}
