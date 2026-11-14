// SCN-29 — normalized snapshot + diff for website monitoring. Fetch (SSRF-guarded) → extract
// readable text → normalize → hash. A change is "hash differs"; the diff yields a short,
// human-readable 'what changed' summary (added/removed lines, with a price-change hint).
import { createHash } from 'node:crypto';
import { safeFetch } from './ssrfGuard';
import { extractReadable } from './learn';

export interface Snapshot {
  title: string;
  text: string;
  hash: string;
}

const FETCH_TIMEOUT_MS = 12_000;
const MAX_SNAPSHOT_CHARS = 20_000;

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SNAPSHOT_CHARS);
}

export async function snapshot(url: string): Promise<Snapshot> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SecureStudioMonitor/1.0)',
        Accept: 'text/html,application/xhtml+xml,text/plain',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) throw new Error(`fetch returned ${res.status}`);
    const html = await res.text();
    const { title, text } = extractReadable(html);
    const normalized = normalize(text);
    const hash = createHash('sha256').update(normalized).digest('hex');
    return { title, text: normalized, hash };
  } finally {
    clearTimeout(timer);
  }
}

const PRICE_RE = /(?:₹|rs\.?|inr)\s?[\d,]+(?:\.\d+)?/gi;

// A compact, human-readable summary of what changed between two snapshots' text.
export function diffSummary(oldText: string, newText: string, max = 3): string {
  const oldLines = new Set(oldText.split(/[\n.]/).map((l) => l.trim()).filter(Boolean));
  const added = newText
    .split(/[\n.]/)
    .map((l) => l.trim())
    .filter((l) => l && !oldLines.has(l));

  const oldPrices = (oldText.match(PRICE_RE) || []).map((p) => p.toLowerCase());
  const newPrices = (newText.match(PRICE_RE) || []).map((p) => p.toLowerCase());
  const priceChanged = oldPrices.join('|') !== newPrices.join('|') && (oldPrices.length || newPrices.length);

  const parts: string[] = [];
  if (priceChanged) parts.push(`Price/offer changed (was ${oldPrices.slice(0, 2).join(', ') || '—'}; now ${newPrices.slice(0, 2).join(', ') || '—'}).`);
  if (added.length) parts.push(`New: ${added.slice(0, max).join(' · ').slice(0, 200)}`);
  return parts.join(' ') || 'The page changed.';
}
