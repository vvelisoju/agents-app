// STU-5 — natural-language agent builder. Generalizes learn.ts's proven pattern (one
// model call -> defensive parse -> owner-confirmed draft) into: plain description (+ optional
// link) => a VALIDATED AgentSpec draft (never executable code). The owner reviews it before
// anything is saved. Guardrail: never invent prices/offers/facts not in the input.
import { generate } from './brain';
import { AgentSpec, validateSpec } from './agentSpec';
import { learnFromUrl } from './learn';

function ownerError(msg: string): Error & { friendly?: boolean } {
  const e = new Error(msg) as Error & { friendly?: boolean };
  e.friendly = true;
  return e;
}

function parseJson(raw: string): any {
  let s = (raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

export async function generateSpecFromNL(
  description: string,
  opts: { url?: string; channelType?: string } = {},
): Promise<{ spec: AgentSpec; warnings: string[] }> {
  const warnings: string[] = [];
  const desc = String(description || '').trim();
  if (desc.length < 3) throw ownerError('Please describe what your agent should do.');

  let learned: any = null;
  if (opts.url) {
    try {
      learned = await learnFromUrl('your business', opts.url);
    } catch {
      warnings.push('We could not read that link, so the agent was built from your description only.');
    }
  }

  const system =
    'You configure a friendly customer-service AI agent for a small business from a short description. ' +
    'Respond with ONLY a JSON object, no prose, no markdown. Never invent prices, offers, phone numbers, ' +
    'or facts that are not present in the input — omit anything you are unsure of. Keep every item short and WhatsApp-ready.';
  const prompt =
    `Description: "${desc}"\n` +
    (learned ? `Facts read from their website:\n"""${JSON.stringify(learned.suggestion)}"""\n` : '') +
    'Return JSON with EXACTLY these keys: {"name": "a short agent name", "instructions": "2-4 sentences on how to help ' +
    'customers for THIS business", "tone": "a few words", "language": "e.g. match the customer", "facts": ["short factual ' +
    'lines actually supported by the input"], "faqs": [{"question":"...","answer":"..."}], "links": [{"name":"...","url":"https://..."}]}. ' +
    'Use [] for anything you cannot fill.';

  const res = await generate({ system, prompt, maxTokens: 1500 });
  let data: any = {};
  try {
    data = parseJson(res.text);
  } catch {
    warnings.push('We drafted a starting point but could not fully parse it — please review and edit.');
  }

  const str = (x: any) => String(x ?? '').trim();
  const knowledge = [
    ...(Array.isArray(data.facts) ? data.facts : [])
      .map((f: any) => ({ type: 'fact' as const, data: { content: str(f) }, enabled: true }))
      .filter((k: any) => k.data.content),
    ...(Array.isArray(data.faqs) ? data.faqs : [])
      .map((f: any) => ({ type: 'faq' as const, data: { question: str(f?.question), answer: str(f?.answer) }, enabled: true }))
      .filter((k: any) => k.data.question && k.data.answer),
    ...(Array.isArray(data.links) ? data.links : [])
      .map((l: any) => ({ type: 'link' as const, data: { name: str(l?.name), url: str(l?.url) }, enabled: true }))
      .filter((k: any) => k.data.name && /^https?:\/\//i.test(k.data.url)),
    ...((learned?.suggestion?.links || []) as any[]).map((l) => ({ type: 'link' as const, data: { name: l.name, url: l.url }, enabled: true })),
  ].slice(0, 20);

  const v = validateSpec({
    identity: { name: str(data.name) || desc.slice(0, 40) || 'My agent' },
    channel: { type: opts.channelType || 'whatsapp-web', channelConfig: {} },
    persona: {
      instructions: str(data.instructions),
      tone: str(data.tone) || undefined,
      language: str(data.language) || undefined,
    },
    knowledge,
    behavior: { approval: 'draft' },
  });
  if (!v.ok) throw ownerError('We drafted something but it did not validate — please rephrase and try again.');
  return { spec: v.spec, warnings };
}
