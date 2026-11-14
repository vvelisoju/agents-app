// TOOL-04 — map a registered Tool's zod inputSchema to an Anthropic tool definition using
// zod 4's native JSON-Schema conversion. Anthropic wants a plain object JSON Schema; we strip
// the $schema key it doesn't need.
import { z } from 'zod';
import type { Tool } from './types';
import type { AnthropicTool } from '../lib/model-gateway';

export function toAnthropicTool(tool: Tool): AnthropicTool {
  const schema = z.toJSONSchema(tool.inputSchema) as Record<string, unknown>;
  delete schema.$schema;
  return { name: tool.name, description: tool.description, input_schema: schema };
}
