// Turns an agent's training (profile + sources) into a system prompt, and swaps
// {{LINK:Name}} tokens for the real URLs so shared links are always exact.
// Ported verbatim from the skeleton (pure functions — channel-agnostic).

export interface Source {
  id: string;
  type: 'fact' | 'link' | 'faq';
  data: any;
  enabled: boolean;
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
