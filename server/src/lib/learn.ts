// =============================================================
// lib/learn.ts — "Train from a link" (reused from the skeleton).
// Paste a link → fetch → extract readable text → Claude condenses
// into a confirmable training draft (instructions, tone, facts,
// FAQs, shareable links). The heart of the invisible-UI training.
// =============================================================
import { askClaude } from './brain';

export interface LearnSuggestion {
  summary: string;
  instructions: string;
  tone: string;
  language: string;
  facts: string[];
  faqs: { question: string; answer: string }[];
  links: { name: string; url: string }[];
}

export interface LearnResult {
  source: { url: string; title: string; chars: number };
  suggestion: LearnSuggestion;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_TEXT_CHARS = 12_000;

function ownerError(msg: string): Error & { friendly?: boolean } {
  const e = new Error(msg) as Error & { friendly?: boolean };
  e.friendly = true;
  return e;
}

export function normaliseUrl(input: string): string {
  let u = (input || '').trim();
  if (!u) throw new Error('Please paste a link.');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    return new URL(u).toString();
  } catch {
    throw new Error("That does not look like a link. Try something like https://your-business.com");
  }
}

async function fetchHtml(url: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) throw ownerError(`The link returned ${res.status}. It may be private or need a login — try a public link like your website.`);
    const type = res.headers.get('content-type') || '';
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw ownerError(`That link is a ${type.split(';')[0]} file, not a readable page. Paste the page it lives on instead.`);
    }
    return await res.text();
  } catch (e: any) {
    if (e?.name === 'AbortError') throw ownerError('The link took too long to respond. Try again, or use a different link.');
    if (e?.friendly) throw e;
    throw ownerError("We couldn't reach that link. Check the address is correct and the page is public, then try again.");
  } finally {
    clearTimeout(timer);
  }
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
  '&apos;': "'", '&nbsp;': ' ', '&rsquo;': '’', '&lsquo;': '‘',
  '&rdquo;': '”', '&ldquo;': '“', '&mdash;': '—', '&ndash;': '–',
};
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? decodeEntities(m[1]).trim() : '';
}

export function extractReadable(html: string): { title: string; text: string } {
  const title =
    firstMatch(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);

  const metaBits = [
    firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i),
    firstMatch(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i),
    firstMatch(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i),
  ].filter(Boolean);

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(body)
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n')
    .trim()
    .slice(0, MAX_TEXT_CHARS);

  const header = [title, ...metaBits].filter(Boolean).join('\n');
  return { title, text: (header ? header + '\n\n' : '') + text };
}

function parseJson(raw: string): any {
  let s = (raw || '').trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

function asStringList(v: any, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, max);
}

export async function learnFromUrl(agentName: string, rawUrl: string): Promise<LearnResult> {
  const url = normaliseUrl(rawUrl);
  const html = await fetchHtml(url);
  const { title, text } = extractReadable(html);

  if (text.replace(/\s/g, '').length < 40) {
    throw new Error(
      "We couldn't read enough from that link automatically — it may need a login or load its content with " +
      'JavaScript. Try your website link, or add a couple of facts by hand below.',
    );
  }

  const system =
    `You set up a friendly WhatsApp assistant for a small business by reading a page about that business. ` +
    `From the page content, produce a training draft the owner can confirm in one glance. ` +
    `Be faithful to the page — never invent prices, offers, phone numbers or facts that are not present. ` +
    `Keep every item short and WhatsApp-ready. Respond with ONLY a JSON object, no prose, no markdown.`;

  const prompt =
    `Business/agent name: "${agentName}".\n` +
    `Source link: ${url}\n\n` +
    `PAGE CONTENT (title + meta + readable text):\n"""\n${text}\n"""\n\n` +
    `Return JSON with EXACTLY these keys:\n` +
    `{\n` +
    `  "summary": "one sentence describing what this business is/does",\n` +
    `  "instructions": "2-4 sentences telling the assistant how to help customers for THIS business (what it offers, what to highlight, when to offer a visit/booking). No preamble.",\n` +
    `  "tone": "a few words, e.g. warm, concise, helpful",\n` +
    `  "language": "e.g. match the customer, or English",\n` +
    `  "facts": ["concrete facts a customer might ask about: what is offered, pricing if clearly stated, hours, location/area, amenities. Max 8, each one short line."],\n` +
    `  "faqs": [{"question": "...", "answer": "..."}],\n` +
    `  "links": [{"name": "Short label e.g. Website/Location/Book", "url": "https://..."}]\n` +
    `}\n` +
    `Only include what the page actually supports. Use [] for anything you cannot fill.`;

  let data: any;
  try {
    const out = await askClaude({ system, prompt, maxTokens: 2000 });
    if (!out.trim()) throw new Error('empty model output (possible refusal)');
    data = parseJson(out);
  } catch (e: any) {
    console.error('learn: summarise failed for', url, '-', e?.message || e);
    throw ownerError('We read the link but could not summarise it just now. Please try again in a moment.');
  }

  const suggestion: LearnSuggestion = {
    summary: String(data.summary || '').trim(),
    instructions: String(data.instructions || '').trim(),
    tone: String(data.tone || '').trim() || 'warm, concise, helpful',
    language: String(data.language || '').trim() || 'match the customer',
    facts: asStringList(data.facts, 8),
    faqs: (Array.isArray(data.faqs) ? data.faqs : [])
      .map((f: any) => ({ question: String(f?.question || '').trim(), answer: String(f?.answer || '').trim() }))
      .filter((f: any) => f.question && f.answer)
      .slice(0, 5),
    links: (Array.isArray(data.links) ? data.links : [])
      .map((l: any) => ({ name: String(l?.name || '').trim(), url: String(l?.url || '').trim() }))
      .filter((l: any) => l.name && /^https?:\/\//i.test(l.url))
      .slice(0, 5),
  };

  return { source: { url, title: title || url, chars: text.length }, suggestion };
}
