// TOOL-04 fix — the Anthropic tools API forbids dots in tool names; our registry uses dotted
// namespaces. Verify the wire name is API-valid and decodes back to the registry name.
import { describe, it, expect } from 'vitest';
import '../src/tools/builtin';
import { listTools } from '../src/tools/registry';
import { toAnthropicTool, encodeToolName, decodeToolName } from '../src/tools/schema';

const ANTHROPIC_NAME = /^[a-zA-Z0-9_-]{1,128}$/;

describe('tool name encoding for the Anthropic API', () => {
  it('round-trips dotted names through __', () => {
    for (const n of ['calendar.book', 'knowledge.search', 'crm.create_lead', 'channel.send_message']) {
      expect(encodeToolName(n)).not.toContain('.');
      expect(decodeToolName(encodeToolName(n))).toBe(n);
    }
  });

  it('every registered tool produces an Anthropic-valid wire name and a dot-free, object schema', () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      const a = toAnthropicTool(t);
      expect(a.name).toMatch(ANTHROPIC_NAME); // would have 400'd the live API otherwise
      expect((a.input_schema as any).type).toBe('object');
      expect((a.input_schema as any).$schema).toBeUndefined();
      expect(decodeToolName(a.name)).toBe(t.name); // decodes back to the registry name
    }
  });
});
