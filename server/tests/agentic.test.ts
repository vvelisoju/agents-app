// TOOL-05/14/21/23 — the bounded agentic loop: a scripted 2-tool scenario completes, the step
// cap and budget gate bound the loop, a non-allowlisted tool is never executed, and (separately)
// the reply path stays byte-identical because the loop is only entered for agentic agents.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';

vi.mock('../src/lib/model-gateway', () => ({ callModel: vi.fn() }));
vi.mock('../src/lib/budget', () => ({ canSpend: vi.fn() }));

import { callModel } from '../src/lib/model-gateway';
import { canSpend } from '../src/lib/budget';
import { runAgenticLoop } from '../src/engine/agentic';
import { __setTool } from '../src/tools/registry';
import type { Tool } from '../src/tools/types';

const model = vi.mocked(callModel);
const spend = vi.mocked(canSpend);

const turn = (over: any) => ({ text: '', model: 'm', provider: 'anthropic', inputTokens: 3, outputTokens: 2, latencyMs: 1, stopReason: 'end_turn', refused: false, content: [], toolCalls: [], ...over });
const toolUse = (id: string, name: string, input: any) => turn({ stopReason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], toolCalls: [{ id, name, input }] });

let executed: string[] = [];
const echoTool: Tool = {
  name: 'fake.echo', description: 'echo', inputSchema: z.object({ msg: z.string() }), outputSchema: z.object({ echo: z.string() }),
  sideEffect: 'read', execute: async ({ msg }) => { executed.push(msg); return { echo: msg }; },
};
const ctx = { agent: { id: 'a1' }, orgId: 'org1' } as any;

beforeEach(() => {
  model.mockReset(); spend.mockReset(); executed = [];
  spend.mockResolvedValue({ allowed: true } as any);
  __setTool('fake.echo', echoTool);
});

describe('bounded agentic loop (TOOL-05/23)', () => {
  it('runs a tool then finishes on end_turn, summing usage', async () => {
    model
      .mockResolvedValueOnce(toolUse('t1', 'fake.echo', { msg: 'hello' }))
      .mockResolvedValueOnce(turn({ stopReason: 'end_turn', text: 'All done!' }));

    const r = await runAgenticLoop({ system: 'sys', userText: 'hi', enabledTools: ['fake.echo'], ctx });
    expect(executed).toEqual(['hello']);
    expect(r.text).toBe('All done!');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ tool: 'fake.echo', ok: true });
    expect(r.inputTokens).toBe(6); // two turns summed
    expect(r.stoppedBy).toBe('end_turn');
  });

  it('never executes a tool that is not on the allowlist (TOOL-14)', async () => {
    model
      .mockResolvedValueOnce(toolUse('t1', 'fake.echo', { msg: 'x' })) // model names it…
      .mockResolvedValueOnce(turn({ stopReason: 'end_turn', text: 'ok' }));
    const r = await runAgenticLoop({ system: 's', userText: 'hi', enabledTools: [], ctx }); // …but it's not enabled
    expect(executed).toEqual([]); // never ran
    expect(r.steps[0]).toMatchObject({ tool: 'fake.echo', ok: false, code: 'denied' });
  });

  it('stops at the budget gate before a model turn (TOOL-21)', async () => {
    spend.mockResolvedValue({ allowed: false } as any);
    const r = await runAgenticLoop({ system: 's', userText: 'hi', enabledTools: ['fake.echo'], ctx });
    expect(model).not.toHaveBeenCalled();
    expect(r.stoppedBy).toBe('budget');
  });

  it('bounds a runaway loop by the turn cap', async () => {
    model.mockResolvedValue(toolUse('t', 'fake.echo', { msg: 'again' })); // always asks for a tool
    const r = await runAgenticLoop({ system: 's', userText: 'hi', enabledTools: ['fake.echo'], ctx });
    expect(['turn_cap', 'tool_cap']).toContain(r.stoppedBy);
    expect(model.mock.calls.length).toBeLessThanOrEqual(6); // MAX_TURNS
  });

  it('surfaces a write tool as pending approval without executing it', async () => {
    const writeTool: Tool = {
      name: 'fake.write', description: 'w', inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }),
      sideEffect: 'write', approvalAction: 'booking', execute: async () => { executed.push('WRITE'); return { ok: true }; },
    };
    __setTool('fake.write', writeTool);
    model
      .mockResolvedValueOnce(toolUse('t1', 'fake.write', {}))
      .mockResolvedValueOnce(turn({ stopReason: 'end_turn', text: "I'll confirm that for you." }));
    const r = await runAgenticLoop({ system: 's', userText: 'book me', enabledTools: ['fake.write'], ctx });
    expect(executed).not.toContain('WRITE'); // gated — never executed in the loop
    expect(r.steps[0]).toMatchObject({ tool: 'fake.write', ok: false, code: 'pending_approval' });
    __setTool('fake.write', null);
  });
});
