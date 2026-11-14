// OBS-1/OBS-5 — write one execution-trace row (an enriched UsageEvent) for a produced
// reply, carrying model/token/cost/latency/outcome so a reply is traceable end-to-end.
// Fire-and-forget: it must NEVER throw into the reply path (mirrors alertOwner).
import prisma from './prisma';
import { costMicros } from './pricing';
import { log } from './log';

export interface TraceInput {
  orgId: string;
  agentId: string;
  executionId: string;
  outcome: string; // sent | draft | needs_human | away | error | ignored | budget_exceeded
  conversationId?: string;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  approvalState?: string;
  errorCode?: string;
  trigger?: string;
  agentVersion?: string;
}

export function writeTrace(t: TraceInput): void {
  const cost = t.model ? costMicros(t.model, t.inputTokens || 0, t.outputTokens || 0) : null;
  prisma.usageEvent
    .create({
      data: {
        orgId: t.orgId,
        agentId: t.agentId,
        type: 'reply',
        executionId: t.executionId,
        outcome: t.outcome,
        conversationId: t.conversationId ?? null,
        model: t.model ?? null,
        provider: t.provider ?? null,
        inputTokens: t.inputTokens ?? null,
        outputTokens: t.outputTokens ?? null,
        costMicros: cost,
        latencyMs: t.latencyMs ?? null,
        approvalState: t.approvalState ?? null,
        errorCode: t.errorCode ?? null,
        trigger: t.trigger ?? 'channel-event',
        agentVersion: t.agentVersion ?? null,
      },
    })
    .then(() =>
      log.info('execution', {
        executionId: t.executionId,
        orgId: t.orgId,
        agentId: t.agentId,
        outcome: t.outcome,
        model: t.model,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        costMicros: cost,
        latencyMs: t.latencyMs,
      }),
    )
    .catch((e: any) => log.error('trace write failed', { err: String(e?.message || e) }));
}
