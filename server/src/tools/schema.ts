// TOOL-04 — map a registered Tool's zod inputSchema to an Anthropic tool definition using
// zod 4's native JSON-Schema conversion. Anthropic wants a plain object JSON Schema; we strip
// the $schema key it doesn't need.
import { z } from 'zod';
import type { Tool } from './types';
import type { AnthropicTool } from '../lib/model-gateway';

// The Anthropic tools API requires tool names to match ^[a-zA-Z0-9_-]{1,128}$ — dots are NOT
// allowed, but our registry uses dotted namespaces (e.g. 'calendar.book'). Encode the dot as '__'
// for the wire, and decode the model's tool_use name back to look the tool up. ('__' is safe:
// no registered name contains a double underscore.)
export function encodeToolName(name: string): string {
  return name.replace(/\./g, '__');
}
export function decodeToolName(name: string): string {
  return name.replace(/__/g, '.');
}

export function toAnthropicTool(tool: Tool): AnthropicTool {
  const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return { name: encodeToolName(tool.name), description: tool.description, input_schema: schema };
}
