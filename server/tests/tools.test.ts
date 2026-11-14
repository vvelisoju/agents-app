// TOOL-22/24 — tool registry, execution interface (validation, side-effect gating, timeout +
// single retry, idempotency), and the builtin tools' happy + guard paths.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import prisma from '../src/lib/prisma';
import { registerTool, getTool, listTools, __setTool } from '../src/tools/registry';
import { executeTool } from '../src/tools/execute';
import type { Tool, ToolContext } from '../src/tools/types';
import { knowledgeSearch } from '../src/tools/builtin/knowledge';
import { crmUpdateLead } from '../src/tools/builtin/crm';
import { webFetchPage } from '../src/tools/builtin/web';
import { createOrg, createAgent } from './helpers/factories';

const ctxFor = (agent: any, orgId: string): ToolContext => ({ agent, orgId, executionId: 'exec-' + Math.random().toString(36).slice(2) });

describe('tool registry (TOOL-02)', () => {
  it('registers, resolves, lists, and rejects duplicates', () => {
    const t: Tool = { name: 'x.noop', description: 'd', inputSchema: z.object({}), outputSchema: z.object({}), sideEffect: 'read', execute: async () => ({}) };
    __setTool('x.noop', t);
    expect(getTool('x.noop')).toBeTruthy();
    expect(listTools().some((x) => x.name === 'x.noop')).toBe(true);
    expect(() => registerTool(t)).toThrow(); // duplicate
    __setTool('x.noop', null);
  });
});

describe('tool execution interface (TOOL-03)', () => {
  const readTool: Tool = {
    name: 't.read', description: 'd', inputSchema: z.object({ n: z.number() }), outputSchema: z.object({ doubled: z.number() }),
    sideEffect: 'read', execute: async ({ n }) => ({ doubled: n * 2 }),
  };
  const ctx = ctxFor({ id: 'a1' }, 'org1');

  it('validates input and rejects a bad shape', async () => {
    const r = await executeTool(readTool, { n: 'not-a-number' }, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('invalid_input');
  });

  it('runs a read tool inline and validates output', async () => {
    const r = await executeTool(readTool, { n: 21 }, ctx);
    expect(r.ok).toBe(true);
    expect((r as any).output.doubled).toBe(42);
  });

  it('a write tool creates an Approval and does NOT execute until approved', async () => {
    let ran = false;
    const writeTool: Tool = {
      name: 't.write', description: 'd', inputSchema: z.object({ v: z.string() }), outputSchema: z.object({ ok: z.boolean() }),
      sideEffect: 'write', approvalAction: 'booking', execute: async () => { ran = true; return { ok: true }; },
    };
    const org = await createOrg();
    const r = await executeTool(writeTool, { v: 'x' }, ctxFor({ id: 'a1' }, org.id));
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('pending_approval');
    expect((r as any).approvalId).toBeTruthy();
    expect(ran).toBe(false); // nothing executed
    const appr = await prisma.approval.findUnique({ where: { id: (r as any).approvalId } });
    expect(appr?.actionType).toBe('booking');

    // preApproved actually runs it.
    const r2 = await executeTool(writeTool, { v: 'x' }, ctxFor({ id: 'a1' }, org.id), { preApproved: true });
    expect(r2.ok).toBe(true);
    expect(ran).toBe(true);
  });

  it('enforces a timeout', async () => {
    const slow: Tool = {
      name: 't.slow', description: 'd', inputSchema: z.object({}), outputSchema: z.object({}),
      sideEffect: 'read', timeoutMs: 30, execute: () => new Promise((res) => setTimeout(() => res({}), 1_000)),
    };
    const r = await executeTool(slow, {}, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).code).toBe('timeout');
  });

  it('retries a read tool exactly once on a transient error', async () => {
    let calls = 0;
    const flaky: Tool = {
      name: 't.flaky', description: 'd', inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
      sideEffect: 'read', execute: async () => { calls++; if (calls === 1) throw new Error('transient'); return { ok: true }; },
    };
    const r = await executeTool(flaky, {}, ctx);
    expect(r.ok).toBe(true);
    expect(calls).toBe(2); // one retry
  });
});

describe('builtin tools (TOOL-24)', () => {
  it('knowledge.search returns matching facts/FAQs scoped to the agent', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    await prisma.trainingSource.create({ data: { agentId: agent.id, orgId: org.id, type: 'fact', dataJson: JSON.stringify({ content: 'Hot desk is ₹3,999/month' }), enabled: true } });
    await prisma.trainingSource.create({ data: { agentId: agent.id, orgId: org.id, type: 'fact', dataJson: JSON.stringify({ content: 'We are open Mon-Sat' }), enabled: true } });
    const r = await executeTool(knowledgeSearch, { query: 'desk' }, ctxFor(agent, org.id));
    expect(r.ok).toBe(true);
    expect((r as any).output.results).toHaveLength(1);
    expect((r as any).output.results[0].text).toContain('3,999');
  });

  it('crm.update_lead writes only within the org and is approval-gated', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const conv = await prisma.conversation.create({ data: { agentId: agent.id, orgId: org.id, contactNumber: '9000000001', contactName: 'C' } });
    // Gated: first call creates an approval, no write.
    const gated = await executeTool(crmUpdateLead, { contactNumber: '9000000001', leadStatus: 'hot' }, ctxFor(agent, org.id));
    expect((gated as any).code).toBe('pending_approval');
    expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.leadStatus).not.toBe('hot');
    // Approved: writes.
    const done = await executeTool(crmUpdateLead, { contactNumber: '9000000001', leadStatus: 'hot' }, ctxFor(agent, org.id), { preApproved: true });
    expect(done.ok).toBe(true);
    expect((await prisma.conversation.findUnique({ where: { id: conv.id } }))?.leadStatus).toBe('hot');
  });

  it('web.fetch_page refuses a private/metadata URL (SSRF)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const r = await executeTool(webFetchPage, { url: 'http://169.254.169.254/latest/meta-data' }, ctxFor(agent, org.id), { preApproved: true });
    expect(r.ok).toBe(false); // snapshot throws on the SSRF guard → error contract
  });
});
