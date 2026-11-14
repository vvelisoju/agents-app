// TOOL-09 / MK-20 — knowledge.search over the agent's knowledge. First tries the document chunk
// store (RAG: vector cosine when an embeddings provider is configured, keyword otherwise); if the
// agent has no indexed documents, falls back to its facts/FAQs. Read-only, scoped to the agent.
// Stable signature — enabling embeddings never changes callers.
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { registerTool } from '../registry';
import type { Tool } from '../types';
import { searchChunks } from '../../lib/knowledge';

export const knowledgeSearch: Tool = {
  name: 'knowledge.search',
  description: "Search the business's saved documents, facts and FAQs for information relevant to the customer's question.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ results: z.array(z.object({ type: z.string(), text: z.string() })) }),
  sideEffect: 'read',
  async execute(input, ctx) {
    // 1) RAG over indexed document chunks (vector or keyword).
    const hits = await searchChunks(ctx.agent.id, input.query, 6);
    if (hits.length) return { results: hits.map((h) => ({ type: 'document', text: h.text })) };

    // 2) Fallback: keyword over facts/FAQs (no documents indexed).
    const rows = await prisma.trainingSource.findMany({
      where: { agentId: ctx.agent.id, enabled: true, type: { in: ['fact', 'faq'] } },
    });
    const q = input.query.toLowerCase();
    const results = rows
      .map((r) => {
        const d = JSON.parse(r.dataJson);
        const text = r.type === 'fact' ? String(d.content ?? '') : `Q: ${d.question ?? ''}\nA: ${d.answer ?? ''}`;
        return { type: r.type, text };
      })
      .filter((r) => r.text.toLowerCase().includes(q))
      .slice(0, 10);
    return { results };
  },
};

registerTool(knowledgeSearch);
