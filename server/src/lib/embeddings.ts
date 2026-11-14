// Pluggable embeddings provider for RAG. Configured via EMBEDDINGS_PROVIDER + the provider's API
// key. When unset, embeddingsConfigured() is false and callers fall back to keyword search — so
// the whole RAG path works today with zero config, and vectors switch on the moment a key is set
// (no code change). Supported: voyage (Anthropic's recommended partner), openai, cohere.
import { log } from './log';

interface ProviderCfg {
  url: string;
  model: string;
  keyEnv: string;
  buildBody: (texts: string[], model: string) => Record<string, unknown>;
  parse: (json: any) => number[][];
}

const PROVIDERS: Record<string, ProviderCfg> = {
  voyage: {
    url: 'https://api.voyageai.com/v1/embeddings',
    model: process.env.EMBEDDINGS_MODEL || 'voyage-3',
    keyEnv: 'VOYAGE_API_KEY',
    buildBody: (texts, model) => ({ input: texts, model }),
    parse: (j) => (j.data || []).map((d: any) => d.embedding),
  },
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    model: process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small',
    keyEnv: 'OPENAI_API_KEY',
    buildBody: (texts, model) => ({ input: texts, model }),
    parse: (j) => (j.data || []).map((d: any) => d.embedding),
  },
  cohere: {
    url: 'https://api.cohere.ai/v1/embed',
    model: process.env.EMBEDDINGS_MODEL || 'embed-english-v3.0',
    keyEnv: 'COHERE_API_KEY',
    buildBody: (texts, model) => ({ texts, model, input_type: 'search_document' }),
    parse: (j) => j.embeddings || [],
  },
};

function activeProvider(): { name: string; cfg: ProviderCfg; key: string } | null {
  const name = process.env.EMBEDDINGS_PROVIDER || '';
  const cfg = PROVIDERS[name];
  if (!cfg) return null;
  const key = process.env[cfg.keyEnv] || '';
  if (!key) return null;
  return { name, cfg, key };
}

export function embeddingsConfigured(): boolean {
  return activeProvider() !== null;
}

export function embeddingsStatus(): { configured: boolean; provider: string | null; model: string | null } {
  const p = activeProvider();
  return { configured: !!p, provider: p?.name ?? null, model: p?.cfg.model ?? null };
}

/** Embed texts via the configured provider. Throws if not configured (caller should guard with
 *  embeddingsConfigured()). Batches are the caller's responsibility; keep batches reasonable. */
export async function embed(texts: string[]): Promise<number[][]> {
  const p = activeProvider();
  if (!p) throw new Error('no embeddings provider configured');
  if (!texts.length) return [];
  const res = await fetch(p.cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.key}` },
    body: JSON.stringify(p.cfg.buildBody(texts, p.cfg.model)),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    log.warn('embeddings request failed', { provider: p.name, status: res.status });
    throw new Error(`embeddings ${p.name} ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return p.cfg.parse(json);
}

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
