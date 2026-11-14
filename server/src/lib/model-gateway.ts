// MGW-1/2/3 + FND-31 — provider-abstracted model gateway. The single place that talks
// to an LLM: timeout, bounded retry on transient errors, and token/cost capture (usage
// was previously discarded). brain.askClaude is now a thin wrapper over this, so every
// caller is unchanged and executionMode='reply' stays byte-for-byte identical.
//
// Persisting the captured usage into an execution-trace row is Phase 2's OBS work and
// needs a migration (blocked on DB-1); callModel already returns it so that lands cleanly.
import Anthropic from '@anthropic-ai/sdk';

// TOOL-04 — an Anthropic tool definition (name + JSON-Schema input).
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ModelCallInput {
  system: string;
  prompt?: string; // convenience for a single user turn
  messages?: { role: 'user' | 'assistant'; content: any }[];
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  provider?: 'anthropic';
  tools?: AnthropicTool[]; // TOOL-04: when omitted the request is byte-for-byte today's
}

export interface ModelCallResult {
  text: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  stopReason: string | null;
  refused: boolean;
  /** Raw assistant content blocks (needed to append to messages for a tool-use follow-up). */
  content?: any[];
  /** Parsed tool_use blocks when stop_reason === 'tool_use'. */
  toolCalls?: ToolCall[];
}

const DEFAULT_MODEL = process.env.AGENT_MODEL || 'claude-haiku-5-5';
const TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS) || 30_000;
const MAX_RETRIES = 2;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set (copy .env.example to .env and add your key).');
  }
  if (!client) client = new Anthropic();
  return client;
}

export function isRetryable(err: any): boolean {
  const s = err?.status ?? err?.statusCode;
  return s === 429 || (typeof s === 'number' && s >= 500 && s < 600) ||
    err?.name === 'APIConnectionError' || err?.name === 'APIConnectionTimeoutError' ||
    err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function callModel(input: ModelCallInput): Promise<ModelCallResult> {
  const model = input.model || DEFAULT_MODEL;
  const provider = input.provider || 'anthropic';
  const maxTokens = input.maxTokens ?? 1024;
  const messages = input.messages ?? [{ role: 'user' as const, content: input.prompt ?? '' }];
  const start = Date.now();

  let lastErr: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res: any = await getClient().messages.create(
        {
          model,
          max_tokens: maxTokens,
          system: input.system,
          output_config: { effort: input.effort || 'low' },
          messages,
          // Only attach tools when the caller passes them → the no-tools request is unchanged.
          ...(input.tools?.length ? { tools: input.tools } : {}),
        } as any,
        { timeout: TIMEOUT_MS } as any,
      );
      const refused = res.stop_reason === 'refusal';
      const content = res.content || [];
      const text = refused
        ? ''
        : content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
      const toolCalls: ToolCall[] = content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, input: b.input || {} }));
      return {
        text,
        model,
        provider,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        latencyMs: Date.now() - start,
        stopReason: res.stop_reason ?? null,
        refused,
        content,
        toolCalls,
      };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES && isRetryable(err)) {
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
