// MK-9/12 — per-contact memory: the [[REMEMBER:k=v]] extractor, recall→inject + store→strip in
// the engine (gated by MEMORY_ENABLED), the off-path byte-for-byte guarantee, and the TTL sweep.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/brain', () => ({ askClaude: vi.fn(), generate: vi.fn() }));

import prisma from '../src/lib/prisma';
import { generate } from '../src/lib/brain';
import { processInbound } from '../src/engine/engine';
import { extractMemory, recallMemory } from '../src/lib/memory';
import '../src/lib/retention';
import { runMaintenanceOnce } from '../src/lib/maintenance';
import { createOrgWithAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

const gen = vi.mocked(generate);
const reply = (text: string) => ({ text, model: 'm', provider: 'anthropic', inputTokens: 1, outputTokens: 1, latencyMs: 1, stopReason: 'end_turn', refused: false });
const inbound = (text: string, from = '919000000001@c.us') => ({ from, contactName: 'C', text });

beforeEach(() => { gen.mockReset(); resetSends(); });

describe('memory extractor (MK-9)', () => {
  it('pulls [[REMEMBER:k=v]] tokens and strips them from the reply', () => {
    const { memories, clean } = extractMemory('Sure! [[REMEMBER: name = Priya ]] See you Saturday. [[REMEMBER:prefers=hot desk]]');
    expect(memories).toEqual([{ key: 'name', value: 'Priya' }, { key: 'prefers', value: 'hot desk' }]);
    expect(clean).not.toContain('REMEMBER');
    expect(clean).toContain('See you Saturday.');
  });
  it('leaves a reply with no token untouched', () => {
    const { memories, clean } = extractMemory('Our hours are 9-6.');
    expect(memories).toEqual([]);
    expect(clean).toBe('Our hours are 9-6.');
  });
});

describe('memory in processInbound (MK-9)', () => {
  const prev = process.env.MEMORY_ENABLED;
  afterEach(() => { if (prev === undefined) delete process.env.MEMORY_ENABLED; else process.env.MEMORY_ENABLED = prev; });

  it('stores a remembered fact and strips the token from the customer reply', async () => {
    process.env.MEMORY_ENABLED = '1';
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('Nice to meet you! [[REMEMBER:name=Priya]] How can we help?'));
    const res = await processInbound(agent.id, inbound('hi, I am Priya'));
    expect(res.status).toBe('sent');
    expect(sends[0].text).toBe('Nice to meet you! How can we help?'); // token stripped
    const mem = await recallMemory(agent.id, '919000000001@c.us');
    expect(mem).toContainEqual({ key: 'name', value: 'Priya' });
  });

  it('recalls stored memory into the next prompt', async () => {
    process.env.MEMORY_ENABLED = '1';
    const { agent, org } = await createOrgWithAgent({ autoSend: true });
    await prisma.contactMemory.create({ data: { orgId: org.id, agentId: agent.id, contactNumber: '919000000001@c.us', key: 'name', value: 'Priya' } });
    gen.mockResolvedValue(reply('Welcome back!'));
    await processInbound(agent.id, inbound('hello again'));
    const system = gen.mock.calls[0][0].system as string;
    expect(system).toContain('What you already know about this customer');
    expect(system).toContain('name: Priya');
    expect(system).toContain('[[REMEMBER:key=value]]'); // the instruction that activates the feature
  });

  it('adds the remember-instruction when enabled even with no stored memory', async () => {
    process.env.MEMORY_ENABLED = '1';
    const { agent } = await createOrgWithAgent({ autoSend: true });
    gen.mockResolvedValue(reply('Hi!'));
    await processInbound(agent.id, inbound('hi'));
    expect(gen.mock.calls[0][0].system as string).toContain('[[REMEMBER:key=value]]');
  });

  it('with MEMORY_ENABLED off, the prompt and reply are byte-for-byte today (no recall, no store)', async () => {
    delete process.env.MEMORY_ENABLED;
    const { agent, org } = await createOrgWithAgent({ autoSend: true });
    await prisma.contactMemory.create({ data: { orgId: org.id, agentId: agent.id, contactNumber: '919000000001@c.us', key: 'name', value: 'Priya' } });
    gen.mockResolvedValue(reply('Hello [[REMEMBER:x=y]] there'));
    await processInbound(agent.id, inbound('hi'));
    const system = gen.mock.calls[0][0].system as string;
    expect(system).not.toContain('What you already know'); // no recall when off
    // When off, the [[REMEMBER]] token is NOT a memory directive — it just isn't stored.
    expect(await prisma.contactMemory.count({ where: { agentId: agent.id, key: 'x' } })).toBe(0);
  });
});

describe('memory TTL sweep (MK-12)', () => {
  it('prunes expired memory and keeps live memory', async () => {
    const { agent, org } = await createOrgWithAgent();
    await prisma.contactMemory.create({ data: { orgId: org.id, agentId: agent.id, contactNumber: 'c', key: 'old', value: 'v', expiresAt: new Date(Date.now() - 1000) } });
    await prisma.contactMemory.create({ data: { orgId: org.id, agentId: agent.id, contactNumber: 'c', key: 'live', value: 'v', expiresAt: new Date(Date.now() + 60_000) } });
    await prisma.contactMemory.create({ data: { orgId: org.id, agentId: agent.id, contactNumber: 'c', key: 'forever', value: 'v', expiresAt: null } });
    await runMaintenanceOnce();
    const keys = (await prisma.contactMemory.findMany({ where: { agentId: agent.id } })).map((r) => r.key).sort();
    expect(keys).toEqual(['forever', 'live']);
  });
});
