// TOOL-07/13/16/29 — Phase-6 finish: per-tool-call step trace, channel.send_message tool, and
// AgentSpec tools[] round-trip.
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import prisma from '../src/lib/prisma';
import { executeTool } from '../src/tools/execute';
import { __setTool } from '../src/tools/registry';
import type { Tool, ToolContext } from '../src/tools/types';
import { channelSendMessage } from '../src/tools/builtin/channel';
import { specFromAgent, applySpec } from '../src/lib/agentSpec';
import { createOrg, createAgent } from './helpers/factories';
import { sends, resetSends } from './helpers/mockChannel';

beforeEach(() => resetSends());

describe('per-tool-call step trace (TOOL-16/29)', () => {
  it('writes one redacted step row per call on the agentic path, keyed to executionId', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const tool: Tool = {
      name: 't.trace', description: 'd', inputSchema: z.object({ token: z.string(), n: z.number() }),
      outputSchema: z.object({ ok: z.boolean() }), sideEffect: 'read', execute: async () => ({ ok: true }),
    };
    const ctx: ToolContext = { agent, orgId: org.id, executionId: 'exec-trace-1' };
    const r = await executeTool(tool, { token: 'secret-123', n: 5 }, ctx, { stepIndex: 0 });
    expect(r.ok).toBe(true);

    const steps = await prisma.executionStep.findMany({ where: { executionId: 'exec-trace-1' } });
    expect(steps).toHaveLength(1);
    expect(steps[0].toolName).toBe('t.trace');
    expect(steps[0].outcome).toBe('ok');
    expect(steps[0].approvalState).toBe('inline');
    expect(steps[0].inputJson).toContain('[redacted]'); // token masked
    expect(steps[0].inputJson).not.toContain('secret-123');
  });

  it('writes NO step row when no stepIndex is supplied (reply-mode runs trace nothing)', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id);
    const tool: Tool = { name: 't.notrace', description: 'd', inputSchema: z.object({}), outputSchema: z.object({}), sideEffect: 'read', execute: async () => ({}) };
    await executeTool(tool, {}, { agent, orgId: org.id, executionId: 'exec-none' });
    expect(await prisma.executionStep.count({ where: { executionId: 'exec-none' } })).toBe(0);
  });
});

describe('channel.send_message tool (TOOL-07)', () => {
  it('is gated by approval and only sends once pre-approved', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    const ctx: ToolContext = { agent, orgId: org.id, executionId: 'exec-send' };

    // Without approval → pending_approval, nothing sent.
    const gated = await executeTool(channelSendMessage, { to: '9000000001', message: 'hi' }, ctx);
    expect(gated.ok).toBe(false);
    expect(gated.code).toBe('pending_approval');
    expect(sends).toHaveLength(0);

    // Pre-approved → actually sends.
    const sent = await executeTool(channelSendMessage, { to: '9000000001', message: 'hi' }, ctx, { preApproved: true });
    expect(sent.ok).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0].text).toBe('hi');
  });
});

describe('AgentSpec tools[] round-trip (TOOL-13)', () => {
  it('persists enabled tools through applySpec and reads them back via specFromAgent', async () => {
    const org = await createOrg();
    const agent = await createAgent(org.id, { channelType: 'test' });
    const spec = await specFromAgent(agent.id);
    expect(spec!.tools).toEqual([]);

    await applySpec(agent.id, { ...spec!, tools: ['knowledge.search', 'calendar.book'] } as any);
    const updated = await prisma.agent.findUnique({ where: { id: agent.id } });
    expect((updated as any).executionMode).toBe('agentic'); // non-empty tools → agentic
    const back = await specFromAgent(agent.id);
    expect(back!.tools).toEqual(['knowledge.search', 'calendar.book']);

    // Clearing tools returns to the reply path.
    await applySpec(agent.id, { ...back!, tools: [] } as any);
    expect((await prisma.agent.findUnique({ where: { id: agent.id } }) as any).executionMode).toBe('reply');
  });
});
