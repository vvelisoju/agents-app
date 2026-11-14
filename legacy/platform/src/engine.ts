// =============================================================
// src/engine.ts — the reply engine. On an inbound message it loads
// the agent's CURRENT training from the DB (so edits apply to the
// next message with no restart), builds the prompt, asks Claude,
// then auto-sends or saves a draft. Ported from the prototype.
// =============================================================
import { askClaude } from './brain';
import { composeSystemPrompt, applyLinks, Source } from './training';
import * as realtime from './realtime';
import {
  getAgent, getProfile, listSources, upsertConversation, insertMessage,
  recentMessages, logUsage,
} from './db';

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

// Compose + call Claude for a single customer message (used by the Test Console;
// no sending, no logging).
export async function draftFor(agentId: string, message: string): Promise<string> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error('agent not found');
  const profile = getProfile(agentId);
  const sources = listSources(agentId) as Source[];
  const system = composeSystemPrompt(agent, profile, sources);
  const draft = await askClaude({ system, prompt: buildPrompt(`Customer: ${message}`) });
  return applyLinks(draft, sources);
}

// Handle a real inbound WhatsApp message.
export async function handleInbound(agentId: string, msg: any) {
  if (msg.isStatus || msg.from === 'status@broadcast') return;
  const chat = await msg.getChat();
  if (chat.isGroup) return; // skeleton: skip groups

  const body = (msg.body || '').trim();
  if (!worthReplying(body)) return;

  const agent = getAgent(agentId);
  if (!agent) return;

  const number = (msg.author || msg.from).split('@')[0];
  let contactName = number;
  try { const c = await msg.getContact(); contactName = c.pushname || c.name || number; } catch { /* ignore */ }

  const conv = upsertConversation(agentId, agent.org_id, msg.from, contactName);
  insertMessage(conv.id, agentId, 'inbound', body, 'received');

  const profile = getProfile(agentId);
  const sources = listSources(agentId) as Source[];
  const system = composeSystemPrompt(agent, profile, sources);

  const history = recentMessages(conv.id)
    .map((m: any) => `${m.direction === 'outbound' ? 'Me (business)' : 'Customer'}: ${m.body}`)
    .join('\n');

  let draft: string;
  try {
    draft = await askClaude({ system, prompt: buildPrompt(history || `Customer: ${body}`) });
  } catch (e: any) {
    console.error('Claude error:', e?.message || e);
    return;
  }
  if (!draft) return;

  const esc = profile?.escalation_keyword || 'NEEDS_HUMAN';
  if (draft.includes(esc)) {
    insertMessage(conv.id, agentId, 'outbound', '[needs a human]', 'needs_human');
    realtime.emit(agentId, 'message', { conversationId: conv.id, status: 'needs_human' });
    return;
  }

  draft = applyLinks(draft, sources);

  if (agent.auto_send) {
    try {
      const wa = require('./whatsapp');
      await wa.sendText(agentId, msg.from, draft);
      insertMessage(conv.id, agentId, 'outbound', draft, 'sent');
    } catch (e: any) {
      console.error('send failed:', e?.message || e);
      insertMessage(conv.id, agentId, 'outbound', draft, 'draft');
    }
  } else {
    insertMessage(conv.id, agentId, 'outbound', draft, 'draft');
  }

  logUsage(agent.org_id, agentId);
  realtime.emit(agentId, 'message', { conversationId: conv.id, status: agent.auto_send ? 'sent' : 'draft' });
}
