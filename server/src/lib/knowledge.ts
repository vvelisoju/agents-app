// MK-16/17/18/20 — document chunking + retrieval (RAG). Chunks a document's full text, stores
// them, and searches by vector cosine when an embeddings provider is configured, otherwise by
// keyword (LIKE). Same contract both ways, so enabling embeddings needs no caller change.
import prisma from './prisma';
import { embeddingsConfigured, embed, cosineSim } from './embeddings';

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS = 300;

export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length && chunks.length < MAX_CHUNKS) {
    chunks.push(clean.slice(i, i + size));
    i += size - overlap;
  }
  return chunks;
}

export interface IngestResult { chunks: number; embedded: number }

/** Chunk a document's full text, embed (if configured), and store. Idempotent per (agent,
 *  sourceLabel): a re-ingest replaces that source's chunks. Never throws into the caller. */
export async function ingestChunks(orgId: string, agentId: string, sourceLabel: string, text: string): Promise<IngestResult> {
  const chunks = chunkText(text);
  await prisma.knowledgeChunk.deleteMany({ where: { agentId, sourceLabel } }).catch(() => {});
  if (!chunks.length) return { chunks: 0, embedded: 0 };

  let embeddings: number[][] | null = null;
  if (embeddingsConfigured()) {
    try { embeddings = await embed(chunks); } catch { embeddings = null; }
  }
  await prisma.knowledgeChunk.createMany({
    data: chunks.map((content, idx) => ({
      orgId, agentId, sourceLabel, idx, content,
      embeddingJson: embeddings?.[idx] ? JSON.stringify(embeddings[idx]) : null,
    })),
  });
  return { chunks: chunks.length, embedded: embeddings ? chunks.length : 0 };
}

export interface ChunkHit { text: string; score: number }

/** Top-k relevant chunks for an agent. Vector cosine when embeddings are present + a provider is
 *  configured; keyword (term-overlap) otherwise. Empty when the agent has no chunks. */
export async function searchChunks(agentId: string, query: string, k = 5): Promise<ChunkHit[]> {
  const rows = await prisma.knowledgeChunk.findMany({ where: { agentId } });
  if (!rows.length) return [];

  if (embeddingsConfigured() && rows.some((r) => r.embeddingJson)) {
    let qvec: number[] | null = null;
    try { qvec = (await embed([query]))[0] || null; } catch { qvec = null; }
    if (qvec) {
      return rows
        .filter((r) => r.embeddingJson)
        .map((r) => ({ text: r.content, score: cosineSim(qvec!, safeVec(r.embeddingJson!)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    }
  }

  // Keyword fallback: rank by how many query terms a chunk contains.
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!terms.length) return [];
  return rows
    .map((r) => {
      const text = r.content.toLowerCase();
      return { text: r.content, score: terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0) };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// Re-embed an agent's existing chunks — used after an embeddings provider/key is first configured
// so previously keyword-only documents gain vectors without re-uploading.
export async function reindexAgent(agentId: string): Promise<{ embedded: number }> {
  if (!embeddingsConfigured()) return { embedded: 0 };
  const rows = await prisma.knowledgeChunk.findMany({ where: { agentId } });
  let embedded = 0;
  const BATCH = 64;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let vecs: number[][] | null = null;
    try { vecs = await embed(batch.map((r) => r.content)); } catch { vecs = null; }
    if (!vecs) break;
    for (let j = 0; j < batch.length; j++) {
      await prisma.knowledgeChunk.update({ where: { id: batch[j].id }, data: { embeddingJson: JSON.stringify(vecs[j]) } }).catch(() => {});
      embedded++;
    }
  }
  return { embedded };
}

export async function knowledgeStatus(agentId: string): Promise<{ chunks: number; embedded: number }> {
  const chunks = await prisma.knowledgeChunk.count({ where: { agentId } });
  const embedded = await prisma.knowledgeChunk.count({ where: { agentId, embeddingJson: { not: null } } });
  return { chunks, embedded };
}

function safeVec(json: string): number[] {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
}
