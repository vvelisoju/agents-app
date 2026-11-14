// TOOL-02 — in-process Tool registry, mirroring channels/registry.ts. Tools self-register at
// module load; duplicate names are rejected. listTools() is the single source the picker, the
// gateway, and execution all read from.
import type { Tool } from './types';

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  if (tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
  tools.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name);
}

export function listTools(): Tool[] {
  return [...tools.values()];
}

// Test-only: replace/clear without the duplicate guard.
export function __setTool(name: string, tool: Tool | null): void {
  if (tool) tools.set(name, tool);
  else tools.delete(name);
}
