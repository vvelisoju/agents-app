// MK-1/2/3 — conversation rolling summary: the prompt block, the threshold gating, and that a
// refresh folds older messages into a stored summary. Brain is mocked (no network).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import prisma from '../src/lib/prisma';
import { askClaude } from '../src/lib/brain';
import { summaryBlock, maybeSummarize, RECENT_WINDOW, SUMMARIZE_EVERY } from '../src/lib/summary';
import { createOrg, createAgent } from './helpers/factories';

const ask = vi.mocked(askClaude);

beforeEach(() => { ask.mockReset(); });

async function seedMessages(conversationId: string, orgId: string, agentId: string, n: number) {
  await prisma.message.createMany({
    data: Array.from({ length: n }, (_, i) => ({
      conversationId, orgId, agentId,
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      body: `message ${i}`, status: 'received',
    })),
  });
}

describe('summaryBlock', () => {
  it('formats a stored summary and is empty when absent', () => {
    expect(summaryBlock({ summary: 'Wants a hot desk.', summaryThrough: 5 })).toContain('Conversation so far');
    expect(summaryBlock({ summary: 'Wants a hot desk.', summaryThrough: 5 })).toContain('Wants a hot desk.');
    expect(summaryBlock({ summary: null, summaryThrough: 0 })).toBe('');
    expect(summaryBlock(null)).toBe('');
  });
});

describe('maybeSummarize', () => {
  it('is a no-op below the threshold (no model call, no summary written)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const conv = await prisma.conversation.create({ data: { agentId: agent.id, orgId: org.id, contactNumber: 'c1' } });
    await seedMessages(conv.id, org.id, agent.id, RECENT_WINDOW + 2); // only 2 older than the window

    await maybeSummarize({ id: conv.id, summary: null, summaryThrough: 0 });
    expect(ask).not.toHaveBeenCalled();
    expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.summary).toBeNull();
  });

  it('summarizes older messages once enough accrue and records the coverage', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const conv = await prisma.conversation.create({ data: { agentId: agent.id, orgId: org.id, contactNumber: 'c2' } });
    const total = RECENT_WINDOW + SUMMARIZE_EVERY; // exactly enough older messages
    await seedMessages(conv.id, org.id, agent.id, total);
    ask.mockResolvedValueOnce('Customer wants a hot desk from Monday.');

    await maybeSummarize({ id: conv.id, summary: null, summaryThrough: 0 });

    expect(ask).toHaveBeenCalledTimes(1);
    const after = await prisma.conversation.findUnique({ where: { id: conv.id } });
    expect(after?.summary).toBe('Customer wants a hot desk from Monday.');
    expect(after?.summaryThrough).toBe(total - RECENT_WINDOW); // covers the older messages only
    expect(after?.summaryUpdatedAt).toBeTruthy();
  });

  it('never throws even if the model call fails', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const conv = await prisma.conversation.create({ data: { agentId: agent.id, orgId: org.id, contactNumber: 'c3' } });
    await seedMessages(conv.id, org.id, agent.id, RECENT_WINDOW + SUMMARIZE_EVERY);
    ask.mockRejectedValueOnce(new Error('model down'));
    await expect(maybeSummarize({ id: conv.id, summary: null, summaryThrough: 0 })).resolves.toBeUndefined();
    expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.summary).toBeNull();
  });
});
