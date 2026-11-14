// MK-16/17/18/20 — RAG: chunking, cosine, ingest, keyword + vector search, and the knowledge.search
// tool's document→facts fallback. Embeddings provider is mocked (no network, no key needed).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/embeddings', async (orig) => {
  const actual = await (orig() as Promise<any>);
  return { ...actual, embeddingsConfigured: vi.fn(() => false), embed: vi.fn() };
});

import prisma from '../src/lib/prisma';
import { chunkText, ingestChunks, searchChunks } from '../src/lib/knowledge';
import { cosineSim, embeddingsConfigured, embed } from '../src/lib/embeddings';
import { knowledgeSearch } from '../src/tools/builtin/knowledge';
import { createOrg, createAgent } from './helpers/factories';

const cfg = vi.mocked(embeddingsConfigured);
const emb = vi.mocked(embed);

beforeEach(async () => {
  await prisma.knowledgeChunk.deleteMany();
  cfg.mockReturnValue(false);
  emb.mockReset();
});

describe('chunking + cosine', () => {
  it('returns one chunk for short text and overlapping chunks for long text', () => {
    expect(chunkText('short')).toEqual(['short']);
    const long = 'x'.repeat(2000);
    const chunks = chunkText(long, 700, 120);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].length).toBe(700);
  });
  it('cosineSim: identical=1, orthogonal=0', () => {
    expect(cosineSim([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });
});

describe('ingest + keyword search (no embeddings configured)', () => {
  it('stores chunks (null embeddings) and re-ingest replaces the same source', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const r1 = await ingestChunks(org.id, agent.id, 'brochure.pdf', 'Hot desk is Rs 3999 per month. Open Mon to Sat.');
    expect(r1.chunks).toBe(1);
    expect(r1.embedded).toBe(0);
    expect(await prisma.knowledgeChunk.count({ where: { agentId: agent.id } })).toBe(1);
    await ingestChunks(org.id, agent.id, 'brochure.pdf', 'Updated: hot desk now Rs 4500.');
    const rows = await prisma.knowledgeChunk.findMany({ where: { agentId: agent.id } });
    expect(rows).toHaveLength(1); // replaced, not appended
    expect(rows[0].content).toContain('4500');
  });

  it('keyword search ranks by term overlap', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    await ingestChunks(org.id, agent.id, 'a', 'Parking is free for all members and visitors.');
    await ingestChunks(org.id, agent.id, 'b', 'The hot desk price is Rs 3999 per month.');
    const hits = await searchChunks(agent.id, 'how much is a hot desk price', 3);
    expect(hits[0].text).toContain('3999'); // the price chunk ranks first
  });
});

describe('vector search (embeddings configured, mocked)', () => {
  it('ranks by cosine similarity to the query embedding', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    cfg.mockReturnValue(true);
    // Ingest: embed returns a distinct vector per chunk.
    emb.mockResolvedValueOnce([[1, 0, 0]]); // chunk A
    await ingestChunks(org.id, agent.id, 'A', 'alpha content');
    emb.mockResolvedValueOnce([[0, 1, 0]]); // chunk B
    await ingestChunks(org.id, agent.id, 'B', 'beta content');
    // Query embedding closest to chunk B's vector.
    emb.mockResolvedValueOnce([[0, 0.9, 0.1]]);
    const hits = await searchChunks(agent.id, 'anything', 2);
    expect(hits[0].text).toBe('beta content'); // nearest by cosine
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});

describe('knowledge.search tool fallback', () => {
  it('uses document chunks when present, else facts/FAQs', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    // No chunks → falls back to facts.
    await prisma.trainingSource.create({ data: { agentId: agent.id, orgId: org.id, type: 'fact', dataJson: JSON.stringify({ content: 'We are open Mon-Sat 9-6.' }) } });
    const ctx = { agent, orgId: org.id };
    const r1 = await knowledgeSearch.execute({ query: 'open' }, ctx as any);
    expect((r1 as any).results[0].type).toBe('fact');

    // With chunks → document hits.
    await ingestChunks(org.id, agent.id, 'doc', 'Our address is 12 MG Road, near the metro station.');
    const r2 = await knowledgeSearch.execute({ query: 'address metro station' }, ctx as any);
    expect((r2 as any).results[0].type).toBe('document');
    expect((r2 as any).results[0].text).toContain('MG Road');
  });
});
