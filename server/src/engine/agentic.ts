// TOOL-05/06/14/21 — the bounded tool_use loop (executionMode='agentic'). A sibling to the
// single-turn reply path; the reply path is never touched. Invariants:
//  - only tools the owner explicitly enabled on the agent are offered/executable (TOOL-14);
//  - the per-tenant budget is checked before EVERY model turn, and hard caps bound total turns
//    and tool calls (TOOL-21), so a run can never loop away;
//  - no model-emitted token authorizes a privileged action — write/external tools return
//    pending_approval from tools/execute and the loop surfaces that, it never force-runs them;
//  - a tool result is untrusted data wrapped in a tool_result block, never concatenated into
//    the system prompt (TOOL-20).
// The caller (engine) applies the SAME deterministic post-processing (extractAlert/applyLinks/
// NEEDS_HUMAN) to the returned text as the reply path (TOOL-06).
import { callModel, type ToolCall } from '../lib/model-gateway';
import { canSpend } from '../lib/budget';
import { getTool, listTools } from '../tools/registry';
import { executeTool } from '../tools/execute';
import { toAnthropicTool } from '../tools/schema';
import type { ToolContext } from '../tools/types';

const MAX_TURNS = Number(process.env.AGENTIC_MAX_TURNS) || 6;
const MAX_TOOL_CALLS = Number(process.env.AGENTIC_MAX_TOOL_CALLS) || 8;
const FALLBACK = 'Let me check on that and get back to you.';

export interface AgenticStep {
  tool: string;
  ok: boolean;
  code?: string;
  approvalId?: string;
}

export interface AgenticResult {
  text: string;
  steps: AgenticStep[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
  stoppedBy: 'end_turn' | 'turn_cap' | 'tool_cap' | 'budget' | 'refused';
}

export interface AgenticInput {
  system: string;
  userText: string;
  enabledTools: string[];
  ctx: ToolContext;
  model?: string;
}

export async function runAgenticLoop(input: AgenticInput): Promise<AgenticResult> {
  // TOOL-14: resolve the agent's allowlist against the registry (unknown names dropped).
  const enabled = new Set(input.enabledTools);
  const tools = listTools().filter((t) => enabled.has(t.name));
  const anthropicTools = tools.map(toAnthropicTool);

  const messages: { role: 'user' | 'assistant'; content: any }[] = [{ role: 'user', content: input.userText }];
  const steps: AgenticStep[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let model = input.model || '';
  let provider = 'anthropic';

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // TOOL-21: budget gate before every model turn.
    if (!(await canSpend(input.ctx.orgId)).allowed) {
      return done(FALLBACK, 'budget');
    }

    const res = await callModel({ system: input.system, messages, tools: anthropicTools, model: input.model });
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    model = res.model;
    provider = res.provider;

    if (res.refused) return done('', 'refused');

    if (res.stopReason === 'tool_use' && res.toolCalls?.length) {
      messages.push({ role: 'assistant', content: res.content });
      const toolResults: any[] = [];

      for (const call of res.toolCalls) {
        if (steps.length >= MAX_TOOL_CALLS) {
          toolResults.push(resultBlock(call, 'tool call limit reached', true));
          continue;
        }
        const tool = enabled.has(call.name) ? getTool(call.name) : undefined;
        if (!tool) {
          // A tool named by the model but not on the allowlist is never executed (TOOL-14).
          steps.push({ tool: call.name, ok: false, code: 'denied' });
          toolResults.push(resultBlock(call, 'that tool is not available', true));
          continue;
        }
        const r = await executeTool(tool, call.input, input.ctx);
        if (r.ok) {
          steps.push({ tool: call.name, ok: true });
          toolResults.push(resultBlock(call, JSON.stringify(r.output), false));
        } else {
          steps.push({ tool: call.name, ok: false, code: r.code, approvalId: r.approvalId });
          toolResults.push(resultBlock(call, `${r.code}: ${r.error}`, true));
        }
      }

      messages.push({ role: 'user', content: toolResults });
      if (steps.length >= MAX_TOOL_CALLS) return done(res.text || FALLBACK, 'tool_cap');
      continue;
    }

    // end_turn (or any non-tool stop) → final text.
    return done(res.text || FALLBACK, 'end_turn');
  }

  return done(FALLBACK, 'turn_cap');

  function done(text: string, stoppedBy: AgenticResult['stoppedBy']): AgenticResult {
    return { text, steps, inputTokens, outputTokens, model, provider, stoppedBy };
  }
}

// A tool result is UNTRUSTED data — wrapped in a tool_result block, never merged into the prompt.
function resultBlock(call: ToolCall, content: string, isError: boolean) {
  return { type: 'tool_result', tool_use_id: call.id, content: content.slice(0, 8_000), is_error: isError };
}
