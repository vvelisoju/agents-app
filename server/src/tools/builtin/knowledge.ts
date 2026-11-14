// TOOL-09 — knowledge.search over the agent's facts/FAQs (keyword/LIKE). Read-only, scoped to
// the calling agent. Stable signature so a pgvector backing (TOOL-12) can swap in without
// changing callers.
import { z } from 'zod';
import prisma from '../../lib/prisma';
import { registerTool } from '../registry';
import type { Tool } from '../types';

export const knowledgeSearch: Tool = {
  name: 'knowledge.search',
  description: "Search the business's saved facts and FAQs for information relevant to the customer's question.",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ results: z.array(z.object({ type: z.string(), text: z.string() })) }),
  sideEffect: 'read',
  async execute(input, ctx) {
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
