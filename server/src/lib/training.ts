// Turns an agent's training (profile + sources) into a system prompt, and swaps
// {{LINK:Name}} tokens for the real URLs so shared links are always exact.
// Ported verbatim from the skeleton (pure functions — channel-agnostic).

export interface Source {
  id: string;
  type: 'fact' | 'link' | 'faq';
  data: any;
  enabled: boolean;
}

// Control token the model emits on its own first line for a hot/urgent lead.
// The engine strips this line before the customer sees it and uses the reason
// to alert the owner. Deliberately distinctive so it never collides with prose.
export const ALERT_TOKEN = '[[ALERT]]';

// Pull a leading "[[ALERT]] <reason>" line out of a draft. Returns the reason
// (or null) and the cleaned reply with any such line removed, so the customer
// never sees the control token even if the model misplaces it.
export function extractAlert(text: string): { reason: string | null; clean: string } {
  if (!text) return { reason: null, clean: text };
  let reason: string | null = null;
  const kept = text.split('\n').filter((line) => {
    const m = line.match(/^\s*\[\[\s*ALERT\s*\]\]\s*:?\s*(.*)$/i);
    if (m) { if (!reason) reason = (m[1] || '').trim() || 'customer wants to get started urgently'; return false; }
    return true;
  });
  return { reason, clean: kept.join('\n').trim() };
}

export function composeSystemPrompt(agent: any, profile: any, sources: Source[]): string {
  const on = sources.filter((s) => s.enabled);
  const facts = on.filter((s) => s.type === 'fact').map((s) => `- ${s.data.content}`);
  const faqs = on.filter((s) => s.type === 'faq').map((s) => `Q: ${s.data.question}\nA: ${s.data.answer}`);
  const links = on.filter((s) => s.type === 'link');

  const parts: string[] = [];
  parts.push(`You are the friendly WhatsApp assistant for "${agent.name}". You reply to people who message the business on WhatsApp.`);

  if (profile?.instructions?.trim()) parts.push(`INSTRUCTIONS:\n${profile.instructions.trim()}`);
  if (profile?.restrictions?.trim()) parts.push(`RESTRICTIONS (never break these):\n${profile.restrictions.trim()}`);
  if (facts.length) parts.push(`FACTS YOU KNOW:\n${facts.join('\n')}`);
  if (faqs.length) parts.push(`FAQs:\n${faqs.join('\n\n')}`);

  if (links.length) {
    const list = links.map((s) => `- ${s.data.name}: write the token {{LINK:${s.data.name}}}`).join('\n');
    parts.push(
      `SHAREABLE LINKS — when the person asks for one of these, share it by writing the EXACT token ` +
      `(the system swaps in the real URL). Never type the web address yourself.\n${list}`,
    );
  }

  parts.push(
    `HOW TO REPLY:\n` +
    `- Tone: ${profile?.tone || 'warm, concise, helpful'}. Keep it short (1-4 lines), this is WhatsApp.\n` +
    `- Language: ${profile?.language || 'match the customer'}.\n` +
    `- Answer using only the facts above. Never invent prices, offers or facts you were not given.\n` +
    `- If you do not know something, say you will check or ask them to contact the team.`,
  );

  const esc = profile?.escalationKeyword || 'NEEDS_HUMAN';
  parts.push(`If a message is a complaint, refund/payment dispute, or anything sensitive, reply with exactly: ${esc}`);

  // Urgent-lead alerting (only when the owner has set an alert number). The model
  // signals a hot lead with a control line that the system strips before sending.
  if (agent?.alertNumber) {
    parts.push(
      `URGENT LEAD ALERTS:\n` +
      `A lead is URGENT when the customer clearly wants to get started / onboarded / visit SOON — ` +
      `e.g. "need a desk today", "can I come now / in an hour", "need it urgently / immediately / by tomorrow", ` +
      `"ready to pay / book now", or strong buying intent with time pressure. ` +
      `Simple price/info questions are NOT urgent.\n` +
      `When (and only when) the lead is urgent, make the VERY FIRST LINE of your output exactly:\n` +
      `${ALERT_TOKEN} <6-10 word reason, e.g. "wants to book a cabin, visiting today">\n` +
      `Then on the next line write your normal, warm reply to the customer. ` +
      `Never mention this alert line to the customer and never write ${ALERT_TOKEN} when it is not urgent.`,
    );
  }

  return parts.join('\n\n');
}

export function applyLinks(text: string, sources: Source[]): string {
  if (!text) return text;
  let out = text;
  for (const s of sources) {
    if (s.type === 'link' && s.enabled && s.data?.name && s.data?.url) {
      out = out.split(`{{LINK:${s.data.name}}}`).join(s.data.url);
    }
  }
  return out;
}

export function trainingSummary(profile: any, sources: Source[]): string {
  const on = sources.filter((s) => s.enabled);
  const counts = {
    fact: on.filter((s) => s.type === 'fact').length,
    link: on.filter((s) => s.type === 'link').length,
    faq: on.filter((s) => s.type === 'faq').length,
  };
  const bits = [`${counts.fact} fact(s)`, `${counts.link} link(s)`, `${counts.faq} FAQ(s)`];
  const hasInstr = profile?.instructions?.trim() ? 'with custom instructions' : 'no custom instructions yet';
  return `This agent has ${bits.join(', ')}, ${hasInstr}.`;
}
