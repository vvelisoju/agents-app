// TOOL-03 — the one execution interface every tool runs through. It validates input against the
// tool's zod schema, gates by side-effect class (read runs inline; write/external create an
// Approval and do NOT act until approved), enforces a per-tool timeout with one retry for
// read/idempotent tools, validates output, dedupes within an execution, and emits exactly one
// structured log line. The error contract is a discriminated ToolResult.
import { createHash } from 'node:crypto';
import { log } from '../lib/log';
import { createApproval } from '../policy/approvals';
import type { Tool, ToolContext, ToolResult } from './types';

const DEFAULT_TIMEOUT_MS = 10_000;

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError('tool timed out')), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

function inputHash(name: string, input: unknown): string {
  return createHash('sha256').update(name + ':' + JSON.stringify(input ?? null)).digest('hex').slice(0, 16);
}

// In-execution idempotency: the same (executionId, tool, input) resolves to one shared run.
const inflight = new Map<string, Promise<ToolResult>>();

export interface ExecuteOpts {
  /** Set by the approval executor to actually run a previously-gated write/external tool. */
  preApproved?: boolean;
}

export async function executeTool(tool: Tool, input: unknown, ctx: ToolContext, opts: ExecuteOpts = {}): Promise<ToolResult> {
  const started = Date.now();
  const emit = (outcome: string, extra?: Record<string, unknown>) =>
    log.info('tool', { tool: tool.name, sideEffect: tool.sideEffect, outcome, latencyMs: Date.now() - started, orgId: ctx.orgId, agentId: ctx.agent?.id, ...extra });

  // 1) input validation
  const parsed = tool.inputSchema.safeParse(input);
  if (!parsed.success) {
    emit('invalid_input');
    return { ok: false, code: 'invalid_input', error: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const data = parsed.data;

  // 2) side-effect gating — write/external never act without a passed Approval (TOOL-06 rule).
  if ((tool.sideEffect === 'write' || tool.sideEffect === 'external') && !opts.preApproved) {
    const approval = await createApproval({
      orgId: ctx.orgId,
      actionType: tool.approvalAction || tool.sideEffect,
      agentId: ctx.agent?.id ?? null,
      payload: { tool: tool.name, input: data },
      requestedBy: ctx.requestedBy ?? null,
    });
    emit('pending_approval', { approvalId: approval.id });
    return { ok: false, code: 'pending_approval', error: 'awaiting approval', approvalId: approval.id };
  }

  // 3) in-execution idempotency
  const key = ctx.executionId ? `${ctx.executionId}:${inputHash(tool.name, data)}` : '';
  if (key && inflight.has(key)) return inflight.get(key)!;

  const promise = (async (): Promise<ToolResult> => {
    const timeout = tool.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const canRetry = tool.sideEffect === 'read' || tool.idempotent === true;
    const runOnce = () => withTimeout(Promise.resolve(tool.execute(data, ctx)), timeout);

    let output: unknown;
    try {
      output = await runOnce();
    } catch (e: any) {
      if (e instanceof TimeoutError) { emit('timeout'); return { ok: false, code: 'timeout', error: 'tool timed out' }; }
      if (canRetry) {
        try { output = await runOnce(); }
        catch (e2: any) { emit('error', { error: String(e2?.message || e2) }); return { ok: false, code: 'error', error: String(e2?.message || e2) }; }
      } else {
        emit('error', { error: String(e?.message || e) });
        return { ok: false, code: 'error', error: String(e?.message || e) };
      }
    }

    // 4) output validation
    const outParsed = tool.outputSchema.safeParse(output);
    if (!outParsed.success) { emit('invalid_output'); return { ok: false, code: 'invalid_output', error: 'tool returned an unexpected shape' }; }
    emit('ok');
    return { ok: true, output: outParsed.data };
  })();

  if (key) {
    inflight.set(key, promise);
    void promise.finally(() => inflight.delete(key));
  }
  return promise;
}
