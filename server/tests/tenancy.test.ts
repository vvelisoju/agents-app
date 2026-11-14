// DB-7..10 / DB-13 — orgId is stamped on the previously-transitive tables at write time,
// so tenant isolation is direct rather than only via an agentId join.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import prisma from '../src/lib/prisma';
import { generate } from '../src/lib/brain';
import { processInbound } from '../src/engine/engine';
import { createOrgWithAgent, addSource } from './helpers/factories';

const modelReply = (text: string) => ({ text, model: 'm', provider: 'anthropic', inputTokens: 1, outputTokens: 1, latencyMs: 1, stopReason: 'end_turn', refused: false });

describe('tenant scoping', () => {
  it('stamps orgId on TrainingProfile, TrainingSource, and Messages', async () => {
    const { org, agent } = await createOrgWithAgent({ autoSend: true });
    await addSource(agent.id, 'fact', { content: 'Open 9-5' });
    vi.mocked(generate).mockResolvedValue(modelReply('hello'));

    await processInbound(agent.id, { from: '919000000099@c.us', contactName: 'C', text: 'hi there' });

    const profile = await prisma.trainingProfile.findUnique({ where: { agentId: agent.id } });
    expect(profile?.orgId).toBe(org.id);

    const source = await prisma.trainingSource.findFirst({ where: { agentId: agent.id } });
    expect(source?.orgId).toBe(org.id);

    const msgs = await prisma.message.findMany({ where: { agentId: agent.id } });
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.every((m) => m.orgId === org.id)).toBe(true);
  });
});
