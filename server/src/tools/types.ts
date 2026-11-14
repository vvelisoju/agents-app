// TOOL-01 — the typed Tool contract. MCP-shaped (name + JSON-Schema-able input + structured
// result) so a later McpToolAdapter fits the same registry. A tool declares its side-effect
// class, which drives execution gating in tools/execute.ts: 'read' runs inline; 'write' and
// 'external' route through approve-before-act (an Approval row) — no model-emitted token ever
// authorizes a privileged action.
import type { z } from 'zod';

export type SideEffect = 'read' | 'write' | 'external';

export interface ToolContext {
  agent: any;
  orgId: string;
  conversationId?: string | null;
  executionId?: string;
  /** Decrypted credential injected at call time only (TOOL-27) — never in prompts/logs. */
  credential?: string | null;
  /** Who requested the run (for Approval.requestedBy); null for the agent itself. */
  requestedBy?: string | null;
}

export interface Tool<I = any, O = any> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  sideEffect: SideEffect;
  /** Approval.actionType used when a write/external tool is gated (e.g. 'booking', 'send_reply'). */
  approvalAction?: string;
  /** Provider credential this tool needs from ConnectedAccount (TOOL-27). */
  requiresProvider?: string;
  idempotent?: boolean;
  timeoutMs?: number;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export type ToolErrorCode = 'invalid_input' | 'invalid_output' | 'timeout' | 'denied' | 'pending_approval' | 'error';

export type ToolResult =
  | { ok: true; output: unknown }
  | { ok: false; code: ToolErrorCode; error: string; approvalId?: string };
